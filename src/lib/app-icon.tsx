// Shared abstract mark for the app's generated icons: an ascending 3-bar
// chart on a brand-teal rounded square. Kept as JSX (not a raster asset)
// since no image tooling is available in this environment — rendered via
// ImageResponse in icon.tsx / icon1.tsx / icon2.tsx / apple-icon.tsx.
export function IconMark({ padding, barGap }: { padding: number; barGap: number }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        gap: barGap,
        background: "#0f766e",
        borderRadius: "22%",
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
