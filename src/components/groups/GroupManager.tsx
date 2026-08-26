"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Check,
  Clock,
  Copy,
  LogOut,
  Pencil,
  Shield,
  ShieldOff,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createGroupInvite,
  leaveGroup,
  removeGroupMember,
  renameGroup,
  setGroupAdmin,
  revokeGroupInvite,
  setGroupPayerBreakdown,
} from "@/lib/actions/groups";
import type { Group, GroupInvite, GroupMember } from "@/lib/groups-data";

type Props = {
  group: Group;
  members: GroupMember[];
  invites: GroupInvite[];
  currentUserId: string;
};

// Davet linki SUNUCUDA kurulmuyor: production URL'i bir env değişkenine
// bağlamak yerine tarayıcının kendi origin'i kullanılıyor — kullanıcı zaten
// linki alacağı sayfada duruyor ve TWA/PWA/masaüstü hepsinde doğru origin bu.
function inviteUrl(token: string): string {
  return `${window.location.origin}/davet/${token}`;
}

export function GroupManager({ group, members, invites, currentUserId }: Props) {
  const t = useTranslations("groups");
  const tCommon = useTranslations("common");
  const router = useRouter();

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [removing, setRemoving] = useState<GroupMember | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(group.name);

  // Yetki artık üyelik satırındaki bayraktan geliyor, groups.created_by'dan
  // değil — yöneticilik devredilebilir ve birden fazla olabilir.
  const isAdmin = members.some((m) => m.user_id === currentUserId && m.is_admin);

  async function run(fn: () => Promise<{ error?: string; success?: boolean }>) {
    setPending(true);
    setError(undefined);
    const result = await fn();
    setPending(false);
    if (result.error) {
      setError(result.error);
      return false;
    }
    router.refresh();
    return true;
  }

  async function handleInvite() {
    setPending(true);
    setError(undefined);
    const result = await createGroupInvite(group.id);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setFreshToken(result.token ?? null);
    setCopied(false);
    router.refresh();
  }

  async function handleCopy() {
    if (!freshToken) return;
    await navigator.clipboard.writeText(inviteUrl(freshToken));
    setCopied(true);
  }

  return (
    <Card>
      {/* Kartın kendi başlığı yok: sayfanın h1'i zaten grubun adını
          söylüyor. Grup OLUŞTURMA da burada değil — o iş liste sayfasında,
          ayrı bir bileşende (GroupCreateForm); bu kart yalnızca VAR OLAN bir
          grubun durumunu yönetiyor. */}
      <CardContent className="flex flex-col gap-4 pt-6">
        <>
          {/* Açıklama metni burada tekrar edilmiyor: "bu ne işe yarar"
              sorusunun cevabı liste sayfasındaki boş durumda veriliyor.
              Burada ekranın işi durum göstermek — kim üye, bekleyen
              davet var mı. */}
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
              >
                <Users className="size-5" />
              </span>
              {/* Ad düzenleme yerinde: adı değiştirmek için ayrı bir ekran
                  açmak tek alanlı bir form için fazla. Yalnızca yöneticiye
                  gösteriliyor; asıl kapı RLS (groups_update_admin). */}
              {renaming ? (
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Input
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    maxLength={60}
                    autoFocus
                    aria-label={t("nameLabel")}
                  />
                  <Button
                    size="icon-touch"
                    variant="ghost"
                    aria-label={tCommon("save")}
                    disabled={pending || !draftName.trim()}
                    onClick={async () => {
                      const ok = await run(() => renameGroup(group.id, draftName));
                      if (ok) setRenaming(false);
                    }}
                  >
                    <Check className="size-4" />
                  </Button>
                  <Button
                    size="icon-touch"
                    variant="ghost"
                    aria-label={tCommon("cancel")}
                    onClick={() => {
                      setRenaming(false);
                      setDraftName(group.name);
                    }}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <div className="min-w-0">
                    <p className="truncate text-base font-medium">{group.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("memberCount", { count: members.length })}
                    </p>
                  </div>
                  {isAdmin ? (
                    <Button
                      size="icon-touch"
                      variant="ghost"
                      aria-label={t("rename")}
                      onClick={() => {
                        setDraftName(group.name);
                        setRenaming(true);
                      }}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  ) : null}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1">
              {members.map((member) => (
                <div
                  key={member.user_id}
                  className="flex items-center gap-3 rounded-lg px-1 py-1.5"
                >
                  <span
                    aria-hidden
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground"
                  >
                    {(member.display_name ?? "?").trim().slice(0, 1).toLocaleUpperCase("tr")}
                  </span>
                  {/* "· Sen" yazısı KALDIRILDI: her satırda tekrarlanan bir
                      kelime yerine kendi adın renkle ayrılıyor. Bilgi aynı,
                      gürültü yok. */}
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm",
                      member.user_id === currentUserId && "font-medium text-primary",
                    )}
                  >
                    {member.display_name ?? t("unnamedMember")}
                  </span>
                  {member.is_admin ? (
                    <Badge variant="secondary" className="shrink-0">
                      {t("admin")}
                    </Badge>
                  ) : null}
                  {/* Yöneticilik DEVREDİLEBİLİR: yönetici bir başkasını
                      yönetici yapabilir ya da yetkiyi geri alabilir. Son
                      yöneticinin kendi yetkisini bırakması RPC tarafından
                      engelleniyor (grup sahipsiz kalmasın). */}
                  {isAdmin && member.user_id !== currentUserId ? (
                    <Button
                      variant="ghost"
                      size="icon-touch"
                      aria-label={member.is_admin ? t("demote") : t("promote")}
                      title={member.is_admin ? t("demote") : t("promote")}
                      disabled={pending}
                      onClick={() =>
                        run(() => setGroupAdmin(group.id, member.user_id, !member.is_admin))
                      }
                    >
                      {member.is_admin ? (
                        <ShieldOff className="size-4" />
                      ) : (
                        <Shield className="size-4" />
                      )}
                    </Button>
                  ) : null}
                  {isAdmin && member.user_id !== currentUserId ? (
                    <Button
                      variant="ghost"
                      size="icon-touch"
                      onClick={() => setRemoving(member)}
                      aria-label={t("remove")}
                    >
                      <UserMinus className="size-4" />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>

            {/* Yalnızca kuruculara: grup ayarı, kişisel tercih değil.
                Asıl kapı yine RLS (groups_update_admin) — bu koşul
                sadece anlamsız bir anahtarı üyelere göstermemek için. */}
            {isAdmin ? (
              <>
                <Separator />
                <label className="flex items-start gap-2.5 text-sm">
                  <Checkbox
                    checked={group.show_payer_breakdown}
                    onCheckedChange={(checked) =>
                      run(() => setGroupPayerBreakdown(group.id, checked === true))
                    }
                    className="mt-0.5"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium">{t("payerBreakdownLabel")}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {t("payerBreakdownHint")}
                    </span>
                  </span>
                </label>
              </>
            ) : null}

            <Separator />

            {/* Davet uyarısı ARTIK ÖNCEDEN GÖSTERİLMİYOR: link üretilmeden
                önce okunacak bir şey yok, üretildikten sonra ise tam
                zamanında geliyor ("bu linke sahip olan herkes katılabilir").
                Uyarıyı eyleme yapıştırmak, boş ekrana serpiştirmekten hem
                daha kısa hem daha etkili. */}
            {freshToken ? (
              <div className="flex flex-col gap-2">
                <Input readOnly value={inviteUrl(freshToken)} onFocus={(e) => e.target.select()} />
                <Button variant="outline" size="touch" onClick={handleCopy} className="gap-2">
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {copied ? t("inviteCopied") : t("inviteCopy")}
                </Button>
                <p className="text-xs text-muted-foreground">{t("inviteHint")}</p>
              </div>
            ) : (
              <Button
                variant="outline"
                size="touch"
                onClick={handleInvite}
                disabled={pending}
                className="gap-2"
              >
                <UserPlus className="size-4" />
                {pending ? tCommon("saving") : t("inviteCreate")}
              </Button>
            )}

            {invites.length > 0 ? (
              <div className="flex flex-col gap-1">
                {invites.map((invite) => (
                  <div
                    key={invite.id}
                    className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2"
                  >
                    <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {t("inviteExpires", {
                        date: new Date(invite.expires_at).toLocaleDateString(),
                      })}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-xs"
                      onClick={async () => {
                        await revokeGroupInvite(invite.id);
                        router.refresh();
                      }}
                    >
                      {t("inviteRevoke")}
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Ayrılma yıkıcı bir eylem ve nadiren kullanılıyor — tam
                genişlikte bir butonla davet üretmekle aynı görsel ağırlığı
                taşımamalı. */}
            <div className="flex justify-end border-t border-border pt-3">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs text-signal-caution-foreground"
                onClick={() => setConfirmLeave(true)}
              >
                <LogOut className="size-3.5" />
                {t("leave")}
              </Button>
            </div>
        </>

        {error ? <p className="text-sm text-signal-caution-foreground">{error}</p> : null}
      </CardContent>

      <Dialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("leave")}</DialogTitle>
            <DialogDescription>{t("leaveConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="touch" onClick={() => setConfirmLeave(false)}>
              {tCommon("cancel")}
            </Button>
            <Button
              size="touch"
              disabled={pending}
              onClick={async () => {
                setConfirmLeave(false);
                await run(() => leaveGroup(group.id));
              }}
            >
              {t("leave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("remove")}</DialogTitle>
            <DialogDescription>{t("removeConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="touch" onClick={() => setRemoving(null)}>
              {tCommon("cancel")}
            </Button>
            <Button
              size="touch"
              disabled={pending}
              onClick={async () => {
                const target = removing;
                setRemoving(null);
                if (target) await run(() => removeGroupMember(group.id, target.user_id));
              }}
            >
              {t("remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
