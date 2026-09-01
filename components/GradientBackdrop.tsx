import type { CSSProperties, ReactNode } from "react";

type GradientBackdropProps = {
  children?: ReactNode;
  intensity?: "subtle" | "bold" | number;
  colors?: string[];
  className?: string;
};

export default function GradientBackdrop({ children, intensity = "subtle", colors = ["#7050c8", "#2f8b9b", "#aa5e87"], className = "" }: GradientBackdropProps) {
  const opacity = typeof intensity === "number" ? intensity : intensity === "bold" ? 0.58 : 0.22;
  const blur = typeof intensity === "number" && intensity > 0.4 ? 104 : intensity === "bold" ? 104 : 92;
  return <div className={`gradient-backdrop ${className}`.trim()} style={{ "--gradient-opacity": opacity, "--gradient-blur": `${blur}px` } as CSSProperties} aria-hidden={children ? undefined : true}>
    <span style={{ "--gradient-color": colors[0] || "#7050c8", "--gradient-x": "8%", "--gradient-y": "12%" } as CSSProperties} />
    <span style={{ "--gradient-color": colors[1] || "#2f8b9b", "--gradient-x": "88%", "--gradient-y": "28%" } as CSSProperties} />
    <span style={{ "--gradient-color": colors[2] || "#aa5e87", "--gradient-x": "55%", "--gradient-y": "92%" } as CSSProperties} />
    {children ? <div className="gradient-backdrop-content">{children}</div> : null}
  </div>;
}
