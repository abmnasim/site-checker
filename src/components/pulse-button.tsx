import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "glass" | "danger" | "soft-danger" | "ok";

export function PButton({
  variant = "glass",
  icon = false,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  icon?: boolean;
}) {
  return (
    <button
      type="button"
      {...rest}
      className={`pbtn pbtn-${variant} ${icon ? "pbtn-icon" : ""} ${className}`}
    />
  );
}
