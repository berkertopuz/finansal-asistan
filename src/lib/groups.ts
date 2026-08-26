import { createHash } from "node:crypto";

// Saf yardımcılar — src/lib/actions/groups.ts'e KONAMAZ: "use server"
// dosyasındaki her export'un async bir server action olması zorunlu, senkron
// bir export build'i kırıyor.

export const INVITE_TTL_DAYS = 7;

// Davet token'ının ham hali DB'ye hiç yazılmıyor; hem insert hem kabul
// yolunda AYNI özet hesaplanıyor (bkz. 20260825120000_households.sql,
// group_invites.token_hash — check constraint 64 hane hex bekliyor).
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
