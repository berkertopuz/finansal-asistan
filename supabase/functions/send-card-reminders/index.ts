import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import webpush from "npm:web-push@^3";
import { localeFromProfile, type PromptLocale } from "../_shared/locale.ts";

type CreditCard = { id: string; user_id: string; name: string; statement_day: number; payment_day: number };
type PushSub = { id: string; endpoint: string; p256dh: string; auth_key: string };

const NOTIFICATION_TEXT: Record<PromptLocale, { statementTitle: (n: string) => string; statementBody: string; paymentTitle: (n: string) => string; paymentBody: string }> = {
  tr: {
    statementTitle: (name) => `Ekstre günü: ${name}`,
    statementBody: "Bu ayki ekstreni yükleyebilirsin.",
    paymentTitle: (name) => `Ödeme günü: ${name}`,
    paymentBody: "Kart ödemenin son günü bugün.",
  },
  en: {
    statementTitle: (name) => `Statement day: ${name}`,
    statementBody: "This month's statement is ready to upload.",
    paymentTitle: (name) => `Payment due: ${name}`,
    paymentBody: "Today is the last day to pay your card.",
  },
};

// pg_cron her gün 08:00 TRT'de bunu tetikler (supabase/migrations/20260722120000_credit_cards_and_push.sql).
// generate-buy-suggestions ile aynı desen: auth:["secret"], ctx.supabaseAdmin
// (RLS bypass, tüm kullanıcılar için tek taramada çalışır). Sadece "sadece o
// gün" bildirimi — CLAUDE.md'ye eklenen kullanıcı tercihi, gün-öncesi
// hatırlatma yok.
export default {
  fetch: withSupabase({ auth: ["secret"], cors: "disabled" }, async (_req, ctx) => {
    try {
      webpush.setVapidDetails(
        "mailto:finansal-asistan@example.com",
        Deno.env.get("VAPID_PUBLIC_KEY")!,
        Deno.env.get("VAPID_PRIVATE_KEY")!,
      );

      const todayDay = new Date().getDate();

      const { data: cardsRaw } = await ctx.supabaseAdmin
        .from("credit_cards")
        .select("id, user_id, name, statement_day, payment_day")
        .eq("reminders_enabled", true)
        .or(`statement_day.eq.${todayDay},payment_day.eq.${todayDay}`);
      const cards = (cardsRaw as CreditCard[]) ?? [];

      if (cards.length === 0) {
        return Response.json({ sent: 0, cardsChecked: 0 });
      }

      const userIds = [...new Set(cards.map((c) => c.user_id))];
      const { data: profilesRaw } = await ctx.supabaseAdmin
        .from("profiles")
        .select("id, locale")
        .in("id", userIds);
      const localeByUser = new Map(
        ((profilesRaw as { id: string; locale: string | null }[]) ?? []).map((p) => [
          p.id,
          localeFromProfile(p.locale),
        ]),
      );

      let sent = 0;
      const errors: string[] = [];

      for (const card of cards) {
        const locale = localeByUser.get(card.user_id) ?? "tr";
        const text = NOTIFICATION_TEXT[locale];

        const { data: subsRaw } = await ctx.supabaseAdmin
          .from("push_subscriptions")
          .select("id, endpoint, p256dh, auth_key")
          .eq("user_id", card.user_id);
        const subs = (subsRaw as PushSub[]) ?? [];

        const messages: { title: string; body: string }[] = [];
        if (card.statement_day === todayDay) {
          messages.push({ title: text.statementTitle(card.name), body: text.statementBody });
        }
        if (card.payment_day === todayDay) {
          messages.push({ title: text.paymentTitle(card.name), body: text.paymentBody });
        }

        for (const message of messages) {
          const payload = JSON.stringify(message);
          for (const sub of subs) {
            try {
              await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
                payload,
              );
              sent++;
            } catch (err) {
              // 404/410 = abonelik artık geçersiz (tarayıcı/cihaz kaybedilmiş) —
              // sessizce temizle, gerçek bir hata değil.
              const statusCode = (err as { statusCode?: number }).statusCode;
              if (statusCode === 404 || statusCode === 410) {
                await ctx.supabaseAdmin.from("push_subscriptions").delete().eq("id", sub.id);
              } else {
                errors.push(`${card.id}/${sub.id}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
          }
        }
      }

      return Response.json({ sent, cardsChecked: cards.length, errors });
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }),
};
