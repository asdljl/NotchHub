import { useEffect, useState } from "react";
import { Info, Palette, RotateCcw, SlidersHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { UpdateSection } from "@/components/UpdateSection";
import {
  SETTINGS_LIMITS,
  TRIGGER_MODES,
  type SettingsApi,
  type TriggerMode,
} from "../hooks/useSettings";

type NumberFieldProps = {
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix: string;
  onChange: (value: number) => void;
};

/**
 * Small numeric input. The value is only committed on blur or Enter so that
 * intermediate states while typing ("1" on the way to "100") do not get
 * clamped or trigger a window resize.
 */
function NumberField({
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: NumberFieldProps) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = () => {
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || text.trim() === "") {
      setText(String(value));
      return;
    }
    const clamped = Math.round(Math.min(max, Math.max(min, parsed)));
    setText(String(clamped));
    onChange(clamped);
  };

  return (
    <div className="field">
      <Input
        className="field__input h-7 w-[50px] border-0 bg-transparent px-0 text-right text-xs shadow-none focus-visible:border-transparent focus-visible:ring-0"
        type="number"
        inputMode="numeric"
        value={text}
        min={min}
        max={max}
        step={step}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
      <span className="field__suffix">{suffix}</span>
    </div>
  );
}

export function SettingsView({ settings }: { settings: SettingsApi }) {
  const { settings: value, update, reset, isDefault } = settings;

  const activeTrigger =
    TRIGGER_MODES.find((mode) => mode.id === value.trigger) ?? TRIGGER_MODES[0];

  return (
    <div className="settings">
      <div className="settings__intro">
        <span className="flex items-center gap-1.5">
          <SlidersHorizontal className="size-3 text-primary" />
          交互
        </span>
        <span className="settings__sub">展开面板的方式</span>
      </div>

      <div className="settings__list">
        <div className="setting-row">
          <Label className="setting-row__label text-[12.5px] text-foreground/75">
            触发方式
          </Label>
          <Select
            value={value.trigger}
            onValueChange={(next) => update("trigger", next as TriggerMode)}
          >
            <SelectTrigger
              className="h-[30px] w-[112px] rounded-lg border-white/8 bg-white/6 text-[12px]"
              aria-label="展开触发方式"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRIGGER_MODES.map((mode) => (
                <SelectItem key={mode.id} value={mode.id}>
                  {mode.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="settings__caption flex items-start gap-1.5">
        <Info className="mt-0.5 size-3 shrink-0 text-primary/70" />
        <span>{activeTrigger.hint}</span>
      </div>

      <div className="settings__intro">
        <span className="flex items-center gap-1.5">
          <Palette className="size-3 text-success" />
          外观
        </span>
        <span className="settings__sub">输入后回车或失焦生效</span>
      </div>

      <div className="settings__list">
        <div className="setting-row setting-row--switch">
          <div className="setting-row__text">
            <Label className="text-[12.5px] font-medium text-foreground/80">
              圆点模式
            </Label>
            <span className="setting-row__desc">
              {value.dotMode
                ? "有计时器或待办时变刘海，空闲收成圆点"
                : "始终显示整条刘海，不受活动状态影响"}
            </span>
          </div>
          <Switch
            checked={value.dotMode}
            onCheckedChange={(next) => update("dotMode", next)}
            aria-label="圆点模式"
          />
        </div>

        <div className="setting-row">
          <Label className="setting-row__label text-[12.5px] text-foreground/75">
            透明度
          </Label>
          <NumberField
            value={Math.round(value.opacity * 100)}
            min={Math.round(SETTINGS_LIMITS.opacity.min * 100)}
            max={Math.round(SETTINGS_LIMITS.opacity.max * 100)}
            suffix="%"
            onChange={(next) => update("opacity", next / 100)}
          />
        </div>

        <div className="setting-row">
          <Label className="setting-row__label text-[12.5px] text-foreground/75">
            刘海宽度
          </Label>
          <NumberField
            value={value.capsuleWidth}
            min={SETTINGS_LIMITS.capsuleWidth.min}
            max={SETTINGS_LIMITS.capsuleWidth.max}
            step={SETTINGS_LIMITS.capsuleWidth.step}
            suffix="px"
            onChange={(next) => update("capsuleWidth", next)}
          />
        </div>

        <div className="setting-row">
          <Label className="setting-row__label text-[12.5px] text-foreground/75">
            刘海高度
          </Label>
          <NumberField
            value={value.capsuleHeight}
            min={SETTINGS_LIMITS.capsuleHeight.min}
            max={SETTINGS_LIMITS.capsuleHeight.max}
            step={SETTINGS_LIMITS.capsuleHeight.step}
            suffix="px"
            onChange={(next) => update("capsuleHeight", next)}
          />
        </div>

        <div className="setting-row">
          <Label className="setting-row__label text-[12.5px] text-foreground/75">
            面板宽度
          </Label>
          <NumberField
            value={value.panelWidth}
            min={SETTINGS_LIMITS.panelWidth.min}
            max={SETTINGS_LIMITS.panelWidth.max}
            step={SETTINGS_LIMITS.panelWidth.step}
            suffix="px"
            onChange={(next) => update("panelWidth", next)}
          />
        </div>

        <div className="setting-row">
          <Label className="setting-row__label text-[12.5px] text-foreground/75">
            面板高度
          </Label>
          <NumberField
            value={value.panelHeight}
            min={SETTINGS_LIMITS.panelHeight.min}
            max={SETTINGS_LIMITS.panelHeight.max}
            step={SETTINGS_LIMITS.panelHeight.step}
            suffix="px"
            onChange={(next) => update("panelHeight", next)}
          />
        </div>
      </div>

      <div className="settings__hint">
        刘海 {SETTINGS_LIMITS.capsuleWidth.min}–{SETTINGS_LIMITS.capsuleWidth.max} ×{" "}
        {SETTINGS_LIMITS.capsuleHeight.min}–{SETTINGS_LIMITS.capsuleHeight.max}，
        面板 {SETTINGS_LIMITS.panelWidth.min}–{SETTINGS_LIMITS.panelWidth.max} ×{" "}
        {SETTINGS_LIMITS.panelHeight.min}–{SETTINGS_LIMITS.panelHeight.max}
      </div>

      <UpdateSection />

      <div className="settings__foot">
        <Button
          variant="outline"
          size="sm"
          className="settings__reset"
          onClick={reset}
          disabled={isDefault}
        >
          <RotateCcw className="size-3" />
          恢复默认
        </Button>
        {isDefault ? (
          <Badge variant="success" className="gap-1">
            已是默认配置
          </Badge>
        ) : (
          <span className="settings__note">托盘中可退出应用</span>
        )}
      </div>
    </div>
  );
}
