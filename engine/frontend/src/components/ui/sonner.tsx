import * as React from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import {
  CircleCheckIcon,
  ClockIcon,
  InfoIcon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"

/*
  Toasts use our tokens, not Sonner's own colours. The theme follows <html data-theme> when it is
  set, and the computer's setting when it is not. There is no loading spinner: a loading toast
  shows a still clock, because nothing may loop.
*/
function subscribeToTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  })
  return () => observer.disconnect()
}

function getThemeSnapshot(): ToasterProps["theme"] {
  const forced = document.documentElement.dataset.theme
  return forced === "light" || forced === "dark" ? forced : "system"
}

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = React.useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    () => "system" as const
  )

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-pass" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4 text-review" />,
        error: <OctagonXIcon className="size-4 text-destructive" />,
        loading: <ClockIcon className="size-4" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          fontFamily: "var(--font-sans)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "text-ui! shadow-float! font-sans!",
          actionButton:
            "h-8! rounded-md! bg-primary! px-3! text-ui! font-semibold! text-primary-foreground!",
          cancelButton:
            "h-8! rounded-md! bg-secondary! px-3! text-ui! text-secondary-foreground!",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
