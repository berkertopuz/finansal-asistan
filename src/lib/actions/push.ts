"use server";

import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export type PushState = { error?: string; success?: boolean };

// `subscription` PushSubscription.toJSON()'ın çıktısı — client (kartlar
// sayfası) Notification.requestPermission() + registration.pushManager.subscribe(...)
// sonrasında bunu çağırır. unique(endpoint) constraint'i sayesinde aynı
// cihaz tekrar abone olursa upsert idempotent kalır.
export async function subscribeToPush(subscription: unknown): Promise<PushState> {
  const t = await getTranslations("creditCards.errors");
  const parsed = subscriptionSchema.safeParse(subscription);
  if (!parsed.success) {
    return { error: t("genericInvalid") };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: t("noSession") };
  }

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth_key: parsed.data.keys.auth,
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    return { error: t("saveFailed") };
  }
  return { success: true };
}

export async function unsubscribeFromPush(endpoint: string): Promise<void> {
  const supabase = await createClient();
  // RLS (push_subscriptions_delete_own) zaten çağıranın kendi aboneliğine
  // scope ediyor.
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
}
