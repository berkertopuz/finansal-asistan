// Shared abstract mark for the app's generated icons: an ascending 3-bar
// chart on a brand-teal rounded square. Kept as JSX (not a raster asset)
// since no image tooling is available in this environment — rendered via
// ImageResponse in icon.tsx / icon1.tsx / icon2.tsx / apple-icon.tsx.
//
// `maskable` switches to the variant Android (and the eventual TWA/Play
// Store wrapper) needs: a full-bleed square background instead of our own
// rounded corners (the OS applies its own mask shape — circle, squircle,
// etc. — over the *entire* icon, so self-rounding just fights it and can
// leave transparent slivers at the corners) with the bars kept inside the
// centered "safe zone" a mask is guaranteed not to crop, rather than sized
// for our own borderRadius like the regular icons are.
export function IconMark({
  padding,
  barGap,
  maskable = false,
}: {
  padding: number;
  barGap: number;
  maskable?: boolean;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        gap: barGap,
        background: "#0e9f6e",
        borderRadius: maskable ? 0 : "22%",
        padding,
        boxSizing: "border-box",
      }}
    >
      <div style={{ flex: 1, height: "45%", background: "#5eead4", borderRadius: 2 }} />
      <div style={{ flex: 1, height: "70%", background: "#99f6e4", borderRadius: 2 }} />
      <div style={{ flex: 1, height: "95%", background: "#ffffff", borderRadius: 2 }} />
    </div>
  );
}
