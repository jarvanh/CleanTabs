import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false
    return window.innerWidth < MOBILE_BREAKPOINT
  })

  React.useEffect(() => {
    if (typeof window === "undefined") return

    const mediaQueryList = window.matchMedia(
      `(max-width: ${MOBILE_BREAKPOINT - 1}px)`
    )

    const onChange = () => setIsMobile(mediaQueryList.matches)
    onChange()

    mediaQueryList.addEventListener("change", onChange)
    return () => mediaQueryList.removeEventListener("change", onChange)
  }, [])

  return isMobile
}

