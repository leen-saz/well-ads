import * as React from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

// Toasts for the React pages (docs/PRD.md §4.6). The theme follows <html data-theme> (src/lib/theme.ts), not a
// separate theme provider; colours come from the shared tokens. Right-to-left, at the bottom start corner.
type Theme = NonNullable<ToasterProps["theme"]>
function readTheme(): Theme {
  if (typeof document === "undefined") return "light"
  const t = document.documentElement.dataset.theme
  return t === "dark" ? "dark" : t === "system" ? "system" : "light"
}

function Toaster({ ...props }: ToasterProps) {
  const [theme, setTheme] = React.useState<Theme>(readTheme)
  React.useEffect(() => {
    const o = new MutationObserver(() => setTheme(readTheme()))
    o.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
    return () => o.disconnect()
  }, [])
  return (
    <Sonner
      theme={theme}
      dir="rtl"
      position="bottom-left"
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--paper)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--ui-border)",
          fontFamily: "var(--f-ar)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
