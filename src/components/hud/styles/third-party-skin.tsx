"use client";

import React, { createContext, forwardRef, useContext } from "react";
import { THIRD_PARTY_HUD_LAYOUTS, type HudPreset } from "@/lib/settings/hud-layouts";
import skinCss from "./third-party-skin.module.css";

export type ThirdPartySkin = (typeof THIRD_PARTY_HUD_LAYOUTS)[number]["id"];
export type SkinTone = "default" | "accent" | "gain" | "caution" | "loss" | "info";
export type SkinCut = "sm" | "md" | "lg";

const SKIN_IDS = new Set<string>(THIRD_PARTY_HUD_LAYOUTS.map((l) => l.id));

const SKIN_CLASS: Record<ThirdPartySkin, string> = {
  irdashies: `${skinCss.skinRoot} ${skinCss.skin_irdashies}`,
  racevision: `${skinCss.skinRoot} ${skinCss.skin_racevision}`,
  h2h: `${skinCss.skinRoot} ${skinCss.skin_h2h}`,
  retro: `${skinCss.skinRoot} ${skinCss.skin_retro}`,
  blocks: `${skinCss.skinRoot} ${skinCss.skin_blocks}`,
};

const TONE_CLASS: Record<SkinTone, string> = {
  default: skinCss.tone_default,
  accent: skinCss.tone_accent,
  gain: skinCss.tone_gain,
  caution: skinCss.tone_caution,
  loss: skinCss.tone_loss,
  info: skinCss.tone_info,
};

const CUT_CLASS: Record<SkinCut, string> = {
  sm: skinCss.cut_sm,
  md: skinCss.cut_md,
  lg: skinCss.cut_lg,
};

/** Maps active HUD preset (+ phone override) to its third-party skin id, or null for built-in styles */
export function thirdPartySkinOf(preset: HudPreset, phone = false): ThirdPartySkin | null {
  if (phone) return null;
  return SKIN_IDS.has(preset) ? (preset as ThirdPartySkin) : null;
}

/** Root CSS module classes exposing the active third-party skin tokens */
export function skinRootClass(skin: ThirdPartySkin | null): string | undefined {
  return skin ? SKIN_CLASS[skin] : undefined;
}

const HudSkinContext = createContext<ThirdPartySkin | null>(null);

export const HudSkinProvider: React.FC<{ skin: ThirdPartySkin | null; children: React.ReactNode }> = ({
  skin,
  children,
}) => <HudSkinContext.Provider value={skin}>{children}</HudSkinContext.Provider>;

/** Active third-party HUD skin inside F1TelemetryHud, or null for built-in presets */
export function useHudSkin(): ThirdPartySkin | null {
  return useContext(HudSkinContext);
}

export interface SkinPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: SkinTone;
  cut?: SkinCut;
  innerClassName?: string;
}

/** Surface panel skinned for the active third-party HUD (including Retro octagon bevels) */
export const SkinPanel = forwardRef<HTMLDivElement, SkinPanelProps>(function SkinPanel(
  { tone = "default", cut = "md", className, innerClassName, children, ...rest },
  ref,
) {
  const skin = useHudSkin();
  return (
    <div
      ref={ref}
      className={[skin ? SKIN_CLASS[skin] : "", skinCss.panel, TONE_CLASS[tone], CUT_CLASS[cut], className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      <div className={[skinCss.panelInner, innerClassName].filter(Boolean).join(" ")}>{children}</div>
    </div>
  );
});

export interface SkinBannerProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: SkinTone;
  cut?: SkinCut;
}

/** Alert or notification banner skinned for the active third-party HUD */
export const SkinBanner = forwardRef<HTMLDivElement, SkinBannerProps>(function SkinBanner(
  { tone = "default", cut = "sm", className, children, ...rest },
  ref,
) {
  const skin = useHudSkin();
  return (
    <div
      ref={ref}
      className={[skin ? SKIN_CLASS[skin] : "", skinCss.banner, TONE_CLASS[tone], CUT_CLASS[cut], className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </div>
  );
});

export interface SkinTagProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: SkinTone;
  filled?: boolean;
}

/** Tabular chip/tag skinned for the active third-party HUD */
export const SkinTag: React.FC<SkinTagProps> = ({
  tone = "default",
  filled = false,
  className,
  children,
  ...rest
}) => {
  const skin = useHudSkin();
  return (
    <span
      className={[
        skin ? SKIN_CLASS[skin] : "",
        skinCss.tag,
        TONE_CLASS[tone],
        filled ? skinCss.tagFilled : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </span>
  );
};

export interface SkinButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  soft?: boolean;
}

/** Interactive button styled in the active third-party HUD language */
export const SkinButton = forwardRef<HTMLButtonElement, SkinButtonProps>(function SkinButton(
  { active = false, soft = false, className, type = "button", children, ...rest },
  ref,
) {
  const skin = useHudSkin();
  const activeCls = active ? (soft ? skinCss.btnSoftActive : skinCss.btnActive) : "";
  return (
    <button
      ref={ref}
      type={type}
      className={[skin ? SKIN_CLASS[skin] : "", skinCss.btn, activeCls, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
});

export { skinCss };
