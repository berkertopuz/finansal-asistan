// safeNextPath — açık yönlendirme (open redirect) koruması.
//
// NEDEN VAR: davet akışı giriş sonrası kullanıcıyı bir URL parametresinden
// gelen yola geri gönderiyor. O parametre kullanıcıdan geliyor, yani
// düşman (CLAUDE.md kural 8). Doğrulama tek bir saf fonksiyonda toplandığı
// için testi de ucuz — ve buradaki her satır bir saldırı biçimine karşılık
// geliyor, gelecekte "şu da geçsin" diye gevşetilirse test düşer.
//
// Çalıştırma: npm test

import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { safeNextPath, withNextParam } = await jiti.import("../../src/lib/auth-redirect.ts");

test("uygulama içi yollar geçer", () => {
  assert.equal(safeNextPath("/davet/abc123"), "/davet/abc123");
  assert.equal(safeNextPath("/defter"), "/defter");
  assert.equal(safeNextPath("/hane?x=1"), "/hane?x=1");
});

test("dış adresler varsayılana düşer", () => {
  assert.equal(safeNextPath("https://evil.example"), "/");
  assert.equal(safeNextPath("http://evil.example"), "/");
  // Protokol-göreli: tek eğik çizgiyle başlamıyor gibi görünse de tarayıcı
  // bunu DIŞ adres olarak çözer — en sık kaçırılan durum.
  assert.equal(safeNextPath("//evil.example"), "/");
  assert.equal(safeNextPath("/\\evil.example"), "/");
});

test("kontrol karakteri ve ters bölü reddedilir", () => {
  assert.equal(safeNextPath("/defter\nSet-Cookie: x=1"), "/");
  assert.equal(safeNextPath("/defter\r\nLocation: https://evil.example"), "/");
  assert.equal(safeNextPath("/a\\b"), "/");
});

test("boş / aşırı uzun değerler varsayılana düşer", () => {
  assert.equal(safeNextPath(null), "/");
  assert.equal(safeNextPath(undefined), "/");
  assert.equal(safeNextPath(""), "/");
  assert.equal(safeNextPath("/" + "a".repeat(600)), "/");
});

test("withNextParam varsayılan hedefte parametre eklemez", () => {
  assert.equal(withNextParam("/giris", undefined), "/giris");
  assert.equal(withNextParam("/giris", "/"), "/giris");
  assert.equal(withNextParam("/giris", "https://evil.example"), "/giris");
  assert.equal(
    withNextParam("/giris", "/davet/abc123"),
    "/giris?next=%2Fdavet%2Fabc123",
  );
});
