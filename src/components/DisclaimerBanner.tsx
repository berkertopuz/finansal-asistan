// Server-rendered and static — deliberately not the LLM's job, so it can
// never be omitted by a bad generation (CLAUDE.md rule 2). Always render
// this above the fold on any recommendation surface.
export function DisclaimerBanner() {
  return (
    <div className="border-b border-signal-caution-foreground/20 bg-signal-caution-bg px-4 py-3 text-sm text-signal-caution-foreground">
      Bu öneriler yalnızca bilgilendirme amaçlıdır; yatırım tavsiyesi
      niteliği taşımaz. SPK lisanslı bir danışmana başvurunuz.
    </div>
  );
}
