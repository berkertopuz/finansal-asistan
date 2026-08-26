import type { SupabaseClient } from "@supabase/supabase-js";

export type Group = {
  id: string;
  name: string;
  created_by: string;
  // "Kim ne ödedi" kırılımı gösterilsin mi. Grup bazında, yalnızca kurucu
  // değiştirebiliyor (RLS: groups_update_owner). Bazı çiftler ortak gideri
  // birlikte görmek isteyip kimin ne koyduğunu ekranda tutmak istemiyor —
  // uygulamanın bu konuda görüşü yok, karar grubun.
  show_payer_breakdown: boolean;
};

export type GroupMember = {
  group_id: string;
  user_id: string;
  joined_at: string;
  // Yetki artık üyelik satırında ve DEVREDİLEBİLİR. Önce groups.created_by'a
  // bağlıydı: kurucu tek yöneticiydi, devredemiyordu ve gruptan ayrılırsa
  // grup sahipsiz kalıyordu.
  is_admin: boolean;
  display_name: string | null;
  // "Bu grubu kim kurdu" ayrı bir olgu — yetki taşımıyor, yalnızca bilgi.
  is_creator: boolean;
};

// Bir mükerrer uyarısı "bunlar farklı harcamalar" diye onaylandığında
// saklanan çift. Çift KANONİK (first < second), yani aynı çift iki farklı
// sırayla iki kez kaydedilemiyor.
export type DuplicateReview = {
  first_entry_id: string;
  second_entry_id: string;
};

export type GroupInvite = {
  id: string;
  group_id: string;
  expires_at: string;
  created_at: string;
};

export type GroupEntry = {
  id: string;
  user_id: string;
  group_id: string;
  kind: "expense" | "subscription";
  amount: number;
  category: string | null;
  description: string | null;
  occurred_at: string;
  credit_card_id: string | null;
  payer_name: string | null;
};

// Kullanıcının üyesi olduğu TÜM gruplar. Tek hane kısıtı kalktı: bir kişi
// bir hanede + iki tatilde olabilir (20260826140000_households_to_groups.sql).
// user_id filtresi YOK, tıpkı entries-data.ts gibi: kapsamı RLS kuruyor
// (groups_select_member).
export async function getGroups(supabase: SupabaseClient): Promise<Group[]> {
  const { data, error } = await supabase
    .from("groups")
    .select("id, name, created_by, show_payer_breakdown")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("getGroups: gruplar okunamadı", error);
    return [];
  }

  return (data as Group[]) ?? [];
}

export async function getGroup(supabase: SupabaseClient, groupId: string): Promise<Group | null> {
  const { data, error } = await supabase
    .from("groups")
    .select("id, name, created_by, show_payer_breakdown")
    .eq("id", groupId)
    .maybeSingle();

  if (error) {
    console.error("getGroup: grup okunamadı", error);
    return null;
  }

  return (data as Group) ?? null;
}

// v_group_members ve v_group_entries security-definer view'lar: entries ve
// profiles RLS'ini atlayıp kapsamı kendi WHERE'leriyle kuruyorlar. Sebep
// CLAUDE.md'de — entries_select_own genişletilseydi başkasının satırları
// getEntries'e sızıp kullanıcının KENDİ bakiyesini bozardı.
export async function getGroupMembers(
  supabase: SupabaseClient,
  groupId: string,
): Promise<GroupMember[]> {
  const { data, error } = await supabase
    .from("v_group_members")
    .select("group_id, user_id, joined_at, is_admin, display_name, is_creator")
    .eq("group_id", groupId)
    .order("joined_at", { ascending: true });

  if (error) {
    console.error("getGroupMembers: üyeler okunamadı", error);
    return [];
  }

  return (data as GroupMember[]) ?? [];
}

export async function getPendingInvites(
  supabase: SupabaseClient,
  groupId: string,
): Promise<GroupInvite[]> {
  const { data, error } = await supabase
    .from("group_invites")
    .select("id, group_id, expires_at, created_at")
    .eq("group_id", groupId)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getPendingInvites: davetler okunamadı", error);
    return [];
  }

  return (data as GroupInvite[]) ?? [];
}

// Grup görünümünün TEK okuma yolu. entries'e doğrudan sorgu atılmıyor:
// entries_select_own genişletilmedi (ve genişletilmemeli — CLAUDE.md).
//
// monthStart/monthEnd VERİLMEZSE grubun tüm zamanlı toplamı dönüyor —
// "Tümü" dönemi bunun için var: bir hane aylık ritimde okunur ("bu ay ne
// tuttu"), bir tatil ise toplamda ("bu gezi bana kaça patladı"). Ayrı bir
// tarih aralığı kolonu eklemek yerine dönem seçicisiyle çözülüyor, çünkü
// hangi harcamanın sayılacağını zaten grup üyeliği belirliyor.
export async function getGroupEntries(
  supabase: SupabaseClient,
  groupId: string,
  range?: { start: string; end: string },
): Promise<GroupEntry[]> {
  let query = supabase
    .from("v_group_entries")
    .select(
      "id, user_id, group_id, kind, amount, category, description, occurred_at, credit_card_id, payer_name",
    )
    .eq("group_id", groupId);

  if (range) {
    query = query.gte("occurred_at", range.start).lte("occurred_at", range.end);
  }

  const { data, error } = await query.order("occurred_at", { ascending: false });

  if (error) {
    console.error("getGroupEntries: grup kayıtları okunamadı", error);
    return [];
  }

  return (data as GroupEntry[]) ?? [];
}

// Onaylanmış mükerrer çiftleri. Uyarı sezgisel olduğu için gerçekten iki ayrı
// harcama olabilir; kullanıcı bir kez "farklı" dediyse o çift bir daha
// sorulmamalı — yoksa uyarı kalıcı gürültüye döner ve insanlar bakmayı
// bırakır.
export async function getDuplicateReviews(
  supabase: SupabaseClient,
  groupId: string,
): Promise<DuplicateReview[]> {
  const { data, error } = await supabase
    .from("group_duplicate_reviews")
    .select("first_entry_id, second_entry_id")
    .eq("group_id", groupId);

  if (error) {
    console.error("getDuplicateReviews: onaylar okunamadı", error);
    return [];
  }

  return (data as DuplicateReview[]) ?? [];
}
