"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { INVITE_TTL_DAYS, hashInviteToken } from "@/lib/groups";

export type GroupState = { error?: string; success?: boolean };
// Ham token YALNIZCA burada, bir kez döner: DB'de sadece sha256 özeti var,
// yani link kaybedilirse geri getirilemez, yeni davet üretilir.
export type InviteState = GroupState & { token?: string };

// RPC'ler hatayı RAISE EXCEPTION ile atıyor (SQLSTATE P0001), yani tek
// taşıyıcı error.message. Bilinen her durumu kullanıcı diline çeviriyoruz;
// bilinmeyen hiçbir şey kullanıcıya ham sızmıyor (kural 8: hata mesajı
// kullanıcının geliştirici olduğunu varsayamaz), sağlayıcı ayrıntısı loga.
async function translateRpcError(error: { message?: string }, scope: string): Promise<string> {
  const t = await getTranslations("groups.errors");
  const message = error.message ?? "";
  if (message.includes("already_in_group")) return t("alreadyInGroup");
  if (message.includes("too_many_groups")) return t("tooManyGroups");
  if (message.includes("invalid_or_expired_invite")) return t("inviteInvalid");
  if (message.includes("group_full")) return t("groupFull");
  if (message.includes("not_in_group")) return t("notInGroup");
  if (message.includes("not_group_admin")) return t("notAdmin");
  if (message.includes("last_admin")) return t("lastAdmin");
  if (message.includes("use_leave_group")) return t("generic");
  if (message.includes("not_authenticated")) return t("noSession");
  console.error(`${scope}: beklenmeyen grup RPC hatası`, error);
  return t("generic");
}

const groupIdSchema = z.string().uuid();

export async function createGroup(
  _prevState: GroupState,
  formData: FormData,
): Promise<GroupState> {
  const t = await getTranslations("groups.errors");
  const parsed = z
    .string()
    .trim()
    .min(1, { message: t("nameRequired") })
    .max(60, { message: t("nameTooLong") })
    .safeParse(formData.get("name"));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? t("generic") };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_group", { group_name: parsed.data });

  if (error) {
    return { error: await translateRpcError(error, "createGroup") };
  }

  revalidatePath("/gruplar");
  return { success: true };
}

// Davet OLUŞTURMA sıradan bir insert (RLS: o grubun üyesi olmak yetiyor) —
// üyelik doğurmuyor, yalnızca bir token özeti yazıyor. Üyelik KABUL anında,
// acceptGroupInvite'taki definer RPC içinde doğuyor.
export async function createGroupInvite(groupId: string): Promise<InviteState> {
  const t = await getTranslations("groups.errors");
  const parsedId = groupIdSchema.safeParse(groupId);
  if (!parsedId.success) {
    return { error: t("generic") };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: t("noSession") };
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  // Üye olmadığı bir gruba davet yazmaya kalkarsa RLS reddediyor (42501) —
  // ayrıca bir kontrol gerekmiyor, asıl kapı orası.
  const { error } = await supabase.from("group_invites").insert({
    group_id: parsedId.data,
    token_hash: hashInviteToken(token),
    created_by: user.id,
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    console.error("createGroupInvite: davet yazılamadı", error);
    return { error: t("generic") };
  }

  revalidatePath(`/gruplar/${parsedId.data}`);
  return { success: true, token };
}

// setGroupPayerBreakdown ile aynı desen: yetki RLS'te (groups_update_admin),
// PostgREST filtresiz UPDATE'i reddettiği için id ile filtreleniyor, ve üye
// ama YÖNETİCİ değilse update 0 satır etkileyip HATA VERMEDİĞİ için sessiz
// başarısızlık dönen satır sayısıyla yakalanıyor.
export async function renameGroup(groupId: string, name: string): Promise<GroupState> {
  const t = await getTranslations("groups.errors");
  const parsedId = groupIdSchema.safeParse(groupId);
  const parsedName = z
    .string()
    .trim()
    .min(1, { message: t("nameRequired") })
    .max(60, { message: t("nameTooLong") })
    .safeParse(name);

  if (!parsedId.success) {
    return { error: t("generic") };
  }
  if (!parsedName.success) {
    return { error: parsedName.error.issues[0]?.message ?? t("generic") };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("groups")
    .update({ name: parsedName.data })
    .eq("id", parsedId.data)
    .select("id");

  if (error) {
    console.error("renameGroup: güncellenemedi", error);
    return { error: t("generic") };
  }
  if (!data || data.length === 0) {
    return { error: t("notAdmin") };
  }

  revalidatePath("/gruplar", "layout");
  return { success: true };
}

export async function revokeGroupInvite(id: string): Promise<void> {
  const supabase = await createClient();
  // RLS (group_invites_delete_member) kapsamı zaten kuruyor.
  await supabase.from("group_invites").delete().eq("id", id);
  revalidatePath("/gruplar", "layout");
}

export async function acceptGroupInvite(token: string): Promise<GroupState> {
  const t = await getTranslations("groups.errors");
  const parsed = z.string().trim().min(1).max(200).safeParse(token);
  if (!parsed.success) {
    return { error: t("inviteInvalid") };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_group_invite", {
    invite_token_hash: hashInviteToken(parsed.data),
  });

  if (error) {
    return { error: await translateRpcError(error, "acceptGroupInvite") };
  }

  revalidatePath("/gruplar", "layout");
  return { success: true };
}

export async function leaveGroup(groupId: string): Promise<GroupState> {
  const t = await getTranslations("groups.errors");
  const parsed = groupIdSchema.safeParse(groupId);
  if (!parsed.success) {
    return { error: t("generic") };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("leave_group", { target_group_id: parsed.data });

  if (error) {
    return { error: await translateRpcError(error, "leaveGroup") };
  }

  revalidatePath("/gruplar", "layout");
  return { success: true };
}

export async function removeGroupMember(groupId: string, userId: string): Promise<GroupState> {
  const t = await getTranslations("groups.errors");
  const parsedGroup = groupIdSchema.safeParse(groupId);
  const parsedUser = z.string().uuid().safeParse(userId);
  if (!parsedGroup.success || !parsedUser.success) {
    return { error: t("generic") };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_group_member", {
    target_group_id: parsedGroup.data,
    target_user_id: parsedUser.data,
  });

  if (error) {
    return { error: await translateRpcError(error, "removeGroupMember") };
  }

  revalidatePath("/gruplar", "layout");
  return { success: true };
}

// Yalnızca yönetici değiştirebilir ve bu RLS'te zorlanıyor
// (groups_update_admin); arayüzdeki isAdmin koşulu sadece anlamsız bir
// anahtarı üyelere göstermemek için.
//
// PostgREST filtresiz UPDATE'i reddediyor ("UPDATE requires a WHERE clause",
// 21000) — RLS kapsamı daraltsa bile. Kasıtlı bir güvenlik ağı, o yüzden
// id ile filtreliyoruz. Üye ama kurucu değilse update 0 satır etkiler ve
// HATA VERMEZ; o sessiz başarısızlığı dönen satır sayısıyla yakalıyoruz.
export async function setGroupPayerBreakdown(
  groupId: string,
  enabled: boolean,
): Promise<GroupState> {
  const t = await getTranslations("groups.errors");
  const parsed = groupIdSchema.safeParse(groupId);
  if (!parsed.success) {
    return { error: t("generic") };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("groups")
    .update({ show_payer_breakdown: enabled })
    .eq("id", parsed.data)
    .select("id");

  if (error) {
    console.error("setGroupPayerBreakdown: güncellenemedi", error);
    return { error: t("generic") };
  }
  if (!data || data.length === 0) {
    return { error: t("notAdmin") };
  }

  revalidatePath(`/gruplar/${parsed.data}`);
  return { success: true };
}

// Yöneticilik devri. Yalnızca yönetici yapabilir ve bu RPC'de zorlanıyor;
// arayüzdeki koşul sadece anlamsız bir düğmeyi gizlemek için.
//
// Son yönetici kendi yetkisini bırakamıyor (RPC 'last_admin' atıyor): grup
// yöneticisiz kalırsa adı değiştirilemez, ayarı değiştirilemez, üye
// çıkarılamaz hale gelir ve bunu uygulama içinden düzeltmenin yolu kalmaz.
export async function setGroupAdmin(
  groupId: string,
  userId: string,
  makeAdmin: boolean,
): Promise<GroupState> {
  const t = await getTranslations("groups.errors");
  const parsedGroup = groupIdSchema.safeParse(groupId);
  const parsedUser = z.string().uuid().safeParse(userId);
  if (!parsedGroup.success || !parsedUser.success) {
    return { error: t("generic") };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_group_admin", {
    target_group_id: parsedGroup.data,
    target_user_id: parsedUser.data,
    make_admin: makeAdmin,
  });

  if (error) {
    return { error: await translateRpcError(error, "setGroupAdmin") };
  }

  revalidatePath("/gruplar", "layout");
  return { success: true };
}

// Mükerrer uyarısını "bunlar farklı harcamalar" diye kapatmak.
//
// Onay GRUBUN ortak kararı, kişisel değil: uyarının muhatabı iki kişi birden
// ve birinin "farklı" demesi yeterli — herkese ayrı ayrı sormak aynı soruyu
// iki kez sormak olurdu.
export async function confirmNotDuplicate(
  groupId: string,
  firstEntryId: string,
  secondEntryId: string,
): Promise<GroupState> {
  const t = await getTranslations("groups.errors");
  const parsed = z
    .object({
      groupId: groupIdSchema,
      a: z.string().uuid(),
      b: z.string().uuid(),
    })
    .safeParse({ groupId, a: firstEntryId, b: secondEntryId });
  if (!parsed.success) {
    return { error: t("generic") };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: t("noSession") };
  }

  // Çift KANONİK saklanıyor (first < second) — DB'deki CHECK bunu zorluyor,
  // sıralamayı burada yapmak aynı çiftin iki farklı sırayla iki kez
  // yazılmasını imkânsız kılıyor.
  const [first, second] = [parsed.data.a, parsed.data.b].sort();

  const { error } = await supabase.from("group_duplicate_reviews").insert({
    group_id: parsed.data.groupId,
    first_entry_id: first,
    second_entry_id: second,
    reviewed_by: user.id,
  });

  // 23505 = aynı çift zaten onaylanmış. Yarış durumunda (iki kişi aynı anda
  // onayladı) bu bir hata değil, istenen sonuç.
  if (error && error.code !== "23505") {
    console.error("confirmNotDuplicate: onay yazılamadı", error);
    return { error: t("generic") };
  }

  revalidatePath(`/gruplar/${parsed.data.groupId}`);
  return { success: true };
}

// Yönetici, BAŞKASININ kaydını gruptan çıkarır — silmez. Ayrımın gerekçesi
// 20260826170000 migration'ında: o satır sahibinin kendi defterinde ve kendi
// bakiyesinde duruyor, grubun toplamını düzeltmek için çıkarmak yetiyor.
export async function detachEntryAsAdmin(entryId: string): Promise<GroupState> {
  const t = await getTranslations("groups.errors");
  const parsed = z.string().uuid().safeParse(entryId);
  if (!parsed.success) {
    return { error: t("generic") };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("detach_entry_as_admin", {
    target_entry_id: parsed.data,
  });

  if (error) {
    return { error: await translateRpcError(error, "detachEntryAsAdmin") };
  }

  revalidatePath("/gruplar", "layout");
  revalidatePath("/defter");
  return { success: true };
}
