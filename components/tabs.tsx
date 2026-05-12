import { useContext, useEffect, useMemo, useRef, useState } from "react"
import { browser, Tabs as TTabs, Windows } from "wxt/browser"
import { onMessage } from "webext-bridge/popup"

import { ClassValue } from "clsx"
import { cn } from "@/lib/utils"

// import useMeasure, { RectReadOnly } from 'react-use-measure'
import * as PopoverPrimitive from "@radix-ui/react-popover"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { getRelativeTime } from "@/lib/date"

import {
  ChromeBookmarkIcon,
  ChromeExtensionIcon,
  ChromeIcon,
  ChromeSettingsIcon,
} from "./icons"
import { AppStateContext } from "./providers"
import { FindMatchedRule, Rule } from "@/lib/rule"
import { ShortURL, Flag } from "@/lib/tab"
import { Button } from "./ui/button"
import { Moon, PinIcon } from "lucide-react"

const TAB_GROUP_ID_NONE = -1
const GroupColorValue: Record<chrome.tabGroups.ColorEnum, string> = {
  grey: "#94a3b8",
  blue: "#3b82f6",
  red: "#ef4444",
  yellow: "#eab308",
  green: "#22c55e",
  pink: "#ec4899",
  purple: "#a855f7",
  cyan: "#06b6d4",
  orange: "#f97316",
}

const TabTileClassName = "h-[45px] rounded-[6px] border border-transparent"
const GroupLabelClassName = "h-5 rounded-[6px]"

type BrowserTabGroup = chrome.tabGroups.TabGroup
type BrowserTab = TTabs.Tab & { groupId?: number }

interface ITabSection {
  key: string
  title: string
  tabs: BrowserTab[]
  isGrouped: boolean
  groupId?: number
  group?: BrowserTabGroup
}

interface IWindow {
  window: Windows.Window
  tabs: BrowserTab[]
  sections: ITabSection[]
}

function isTabInGroup(groupId?: number): groupId is number {
  return typeof groupId === "number" && groupId !== TAB_GROUP_ID_NONE
}

function getGroupTitle(group?: BrowserTabGroup, groupId?: number) {
  if (group?.title?.trim()) {
    return group.title
  }

  if (group?.color) {
    return `${group.color[0].toUpperCase()}${group.color.slice(1)} group`
  }

  if (groupId !== undefined) {
    return `Group ${groupId}`
  }

  return "Ungrouped"
}

function getGroupColor(color?: chrome.tabGroups.ColorEnum) {
  return color ? GroupColorValue[color] : GroupColorValue.grey
}

function getGroupLabelTextColor(color?: chrome.tabGroups.ColorEnum) {
  switch (color) {
    case "yellow":
    case "grey":
    case "cyan":
      return "#111827"
    default:
      return "#ffffff"
  }
}

function GroupSwatch({ color }: { color?: chrome.tabGroups.ColorEnum }) {
  return (
    <span
      className="h-2.5 w-2.5 rounded-full border border-white/80 shadow-sm"
      style={{ backgroundColor: color ? GroupColorValue[color] : "#94a3b8" }}
    ></span>
  )
}

async function getTabGroupsById(
  groupIds: number[]
): Promise<Map<number, BrowserTabGroup>> {
  const tabGroupsApi =
    typeof chrome !== "undefined" ? chrome.tabGroups : undefined
  if (!tabGroupsApi?.get || groupIds.length === 0) {
    return new Map()
  }

  const groups = await Promise.all(
    groupIds.map(async (groupId) => {
      try {
        return [groupId, await tabGroupsApi.get(groupId)] as const
      } catch {
        return null
      }
    })
  )

  return new Map(
    groups.filter(
      (group): group is readonly [number, BrowserTabGroup] => group !== null
    )
  )
}

function buildTabSections(
  tabs: BrowserTab[],
  groupsById: Map<number, BrowserTabGroup>
): ITabSection[] {
  const sections: ITabSection[] = []

  tabs.forEach((tab) => {
    const grouped = isTabInGroup(tab.groupId)
    const groupId = grouped ? tab.groupId : undefined
    const previous = sections.at(-1)

    if (
      previous &&
      previous.isGrouped === grouped &&
      previous.groupId === groupId
    ) {
      previous.tabs.push(tab)
    } else {
      const group = groupId !== undefined ? groupsById.get(groupId) : undefined
      sections.push({
        key: grouped
          ? `group-${groupId}-${sections.length}`
          : `ungrouped-${sections.length}`,
        title: grouped ? getGroupTitle(group, groupId) : "Ungrouped",
        tabs: [tab],
        isGrouped: grouped,
        groupId,
        group,
      })
    }
  })

  return sections
}

// the first is current window
async function getAllWindows(): Promise<IWindow[]> {
  let windows: IWindow[] = []

  const current = await browser.windows.getCurrent()

  let wins = await browser.windows.getAll()
  wins = wins.filter((w) => w.id !== current.id)
  wins.unshift(current)
  windows.push(
    ...wins
      .filter((w) => w.id)
      .map((w) => {
        return { window: w, tabs: [], sections: [] }
      })
  )

  // window.id => index
  const windowsIndex = new Map<number, number>(
    windows.map((w, i) => [w.window.id!, i])
  )

  const tabs = (await browser.tabs.query({})) as BrowserTab[]
  const groupIds = new Set<number>()

  tabs.forEach((t) => {
    if (!t.windowId) return

    const i = windowsIndex.get(t.windowId)
    if (i === undefined) return

    windows.at(i)?.tabs.push(t)

    if (isTabInGroup(t.groupId)) {
      groupIds.add(t.groupId)
    }
  })

  const groupsById = await getTabGroupsById([...groupIds])

  windows.forEach((windowEntry) => {
    windowEntry.tabs.sort(
      (left, right) => (left.index ?? 0) - (right.index ?? 0)
    )
    windowEntry.sections = buildTabSections(windowEntry.tabs, groupsById)
  })

  return windows
}

export function Tabs() {
  const [hoverTabId, setHoverTabId] = useState<number | undefined>(undefined)
  const [windows, setWindows] = useState<IWindow[]>([])
  // const tabsBounds = useRef(new Map<number, RectReadOnly>());
  const { flags, setFlags } = useContext(AppStateContext)

  async function refresh() {
    const wins = await getAllWindows()
    console.log(wins)
    setWindows(wins)
  }

  async function upsertFlag(flag: Flag) {
    const i = flags.findIndex((f) => f.id === flag.id)
    if (i < 0) {
      await setFlags([...flags, flag], { toStorage: true })
    } else {
      await setFlags(
        flags.map((f, j) => (j === i ? { ...f, ...flag } : f)),
        { toStorage: true }
      )
    }
  }

  // function setTabBounds(id: number, rect: RectReadOnly) {
  //   tabsBounds.current.set(id, rect)
  // }

  useEffect(() => {
    refresh()
    onMessage("cron:done", () => {
      console.log("cron:done")
      refresh()
    })
  }, [])

  return (
    <div className="flex flex-col gap-2 p-0">
      {windows.map((w, i) => {
        return (
          <div key={w.window.id}>
            <div className="rounded-xl border border-dashed border-neutral-200/90 bg-neutral-50/70 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900/40">
              <div className="mb-2 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400">
                    {i === 0 ? "Current window" : `Window ${i + 1}`}
                  </span>
                  {i === 0 && (
                    <span className="h-1.5 w-1.5 rounded-full bg-primary"></span>
                  )}
                </div>
                <span className="text-xs text-neutral-500 dark:text-neutral-400">
                  {w.tabs.length} tabs
                </span>
              </div>

              <div className="-mt-1.5 leading-none">
                {w.sections.map((section) => {
                  if (!section.isGrouped) {
                    return (
                      <div key={section.key} className="contents">
                        {section.tabs.map((t) => {
                          let flag = flags.find((f) => f.id === t.id)
                          return (
                            <TabItem
                              key={t.id}
                              tab={t}
                              section={section}
                              wrapperClassName="mr-1 inline-flex align-bottom pt-1.5"
                              hoverTabId={hoverTabId}
                              setHoverTabId={setHoverTabId}
                              flag={flag}
                              upsertFlag={upsertFlag}
                              refresh={refresh}
                            />
                          )
                        })}
                      </div>
                    )
                  }

                  const groupColor = getGroupColor(section.group?.color)

                  return (
                    <div
                      key={section.key}
                      className="mr-1 inline align-bottom box-decoration-clone border-b-2 pb-0 leading-none"
                      style={{ borderColor: groupColor }}
                    >
                      <GroupLabelItem
                        section={section}
                        className="relative -top-0.5 mr-1 inline-flex align-bottom"
                      />
                      {section.tabs.map((t, index) => {
                        let flag = flags.find((f) => f.id === t.id)
                        const isLast = index === section.tabs.length - 1
                        return (
                          <TabItem
                            key={t.id}
                            tab={t}
                            section={section}
                            wrapperClassName={cn(
                              "inline-flex align-bottom pt-1.5",
                              !isLast && "mr-1"
                            )}
                            hoverTabId={hoverTabId}
                            setHoverTabId={setHoverTabId}
                            flag={flag}
                            upsertFlag={upsertFlag}
                            refresh={refresh}
                          />
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function GroupLabelItem({
  section,
  className,
}: {
  section: ITabSection
  className?: string
}) {
  const groupColor = getGroupColor(section.group?.color)

  return (
    <div
      className={cn(
        "inline-flex max-w-[220px] items-center gap-2 px-2 py-1 text-xs font-medium transition-[filter] duration-150 hover:brightness-95",
        GroupLabelClassName,
        className
      )}
      style={{
        backgroundColor: groupColor,
        color: getGroupLabelTextColor(section.group?.color),
      }}
      title={`${section.title} (${section.tabs.length} tabs)`}
    >
      <span className="truncate">{section.title}</span>
      <span className="shrink-0 opacity-80">{section.tabs.length}</span>
    </div>
  )
}

function TabItem({
  tab,
  section,
  // setTabBounds,
  hoverTabId,
  setHoverTabId,
  flag,
  upsertFlag,
  refresh,
  wrapperClassName,
}: {
  tab: TTabs.Tab
  section: ITabSection
  // setTabBounds?: (id: number, rect: RectReadOnly) => void,
  hoverTabId?: number
  setHoverTabId: (id?: number) => void
  flag?: Flag
  upsertFlag: (_: Flag) => Promise<void>
  refresh: () => Promise<void>
  wrapperClassName?: string
}) {
  let lastAccess = null
  if (tab.lastAccessed) {
    lastAccess = getRelativeTime(new Date(tab.lastAccessed))
  }

  const [hovering, setHovering] = useState(false)
  const [contentHovering, setContentHovering] = useState(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoveringRef = useRef(false)
  const contentHoveringRef = useRef(false)
  // const [ref, bounds] = useMeasure()
  const { rules, settings } = useContext(AppStateContext)

  const popoverOpen = tab.id === hoverTabId && (hovering || contentHovering)

  // useEffect(() => {
  //   if (tab.id && bounds) {
  //     setTabBounds(tab.id, bounds)
  //   }
  // }, [bounds])

  const matchedRule: Rule | null = useMemo(() => {
    if (tab.url) {
      return FindMatchedRule(rules, tab.url)
    }
    return null
  }, [rules, tab])

  function clearCloseTimer() {
    if (!closeTimerRef.current) return

    clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }

  function setTriggerHovering(value: boolean) {
    hoveringRef.current = value
    setHovering(value)
  }

  function setPopoverHovering(value: boolean) {
    contentHoveringRef.current = value
    setContentHovering(value)
  }

  function scheduleCloseCheck() {
    clearCloseTimer()
    closeTimerRef.current = setTimeout(() => {
      if (!hoveringRef.current && !contentHoveringRef.current) {
        setTriggerHovering(false)
        setPopoverHovering(false)
      }
    }, 300)
  }

  useEffect(() => {
    return () => clearCloseTimer()
  }, [])

  return (
    <div className={wrapperClassName}>
      <Popover open={popoverOpen}>
        <PopoverTrigger
          onMouseEnter={() => {
            clearCloseTimer()
            setTriggerHovering(true)
            setHoverTabId(tab.id)
          }}
          onMouseLeave={() => {
            setTriggerHovering(false)
            scheduleCloseCheck()
          }}
          className="outline-none data-[state=open]:outline-none"
        >
          <div
            className={cn(
              "flex flex-col items-center justify-center gap-1 cursor-pointer px-1 py-1 transition-colors duration-150",
              TabTileClassName,
              tab.active
                ? "bg-primary/20 hover:bg-primary/25"
                : "hover:bg-neutral-200 dark:hover:bg-neutral-800/70",
              flag?.always_keep ? "border-primary/80" : ""
            )}
            onClick={() => {
              browser.tabs.update(tab.id!, { active: true })
              browser.windows.update(tab.windowId!, { focused: true })
            }}
          >
            <Favicon
              tab={tab}
              className="h-6 w-6 hover:scale-[110%] duration-200"
            />
            <TabStatusIndicator discarded={tab.discarded} />
          </div>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={4}
          arrowPadding={0}
          className="w-96 px-3 py-2"
          onMouseEnter={() => {
            clearCloseTimer()
            setPopoverHovering(true)
            setHoverTabId(tab.id)
          }}
          onMouseLeave={() => {
            setPopoverHovering(false)
            scheduleCloseCheck()
          }}
        >
          <PopoverPrimitive.Arrow className="fill-neutral-400" />
          <p className="font-semibold text-[13px] leading-relaxed">
            {tab.title}
          </p>
          <p className="leading-relaxed text-neutral-600">
            {ShortURL(tab.url)}
          </p>
          {section.isGrouped && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <GroupSwatch color={section.group?.color} />
              <span className="font-medium text-neutral-700 dark:text-neutral-200">
                {section.title}
              </span>
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5",
                  settings.CloseTabInGroup
                    ? "border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/80 dark:bg-emerald-950/40 dark:text-emerald-300"
                )}
              >
                {settings.CloseTabInGroup
                  ? "Grouped tab"
                  : "Protected from auto-close"}
              </span>
              {section.group?.collapsed && (
                <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                  Collapsed
                </span>
              )}
            </div>
          )}
          <div className="border-t my-2"></div>
          <div className="font-mono flex justify-between">
            <div className="flex items-center gap-1">
              <span>status: {tab.discarded ? "discarded" : "normal"}</span>
              <TabStatusIndicator discarded={tab.discarded} />
            </div>
            <span>last access: {lastAccess}</span>
          </div>
          <div className="mt-2 flex justify-between items-center">
            <div className="flex items-center gap-1">
              <Button
                title="Always keep this tab"
                onClick={async () => {
                  if (tab.id) {
                    const keep = !!!flag?.always_keep
                    await upsertFlag({ ...flag, id: tab.id, always_keep: keep })
                  }
                }}
                size="icon"
                variant="ghost"
                className="rounded-[6px] w-8 h-8 outline-none focus-visible:ring-offset-0 focus-visible:ring-0 bg-accent"
              >
                <PinIcon
                  strokeWidth={flag?.always_keep ? 2 : 1}
                  className={flag?.always_keep ? "text-primary" : ""}
                />
              </Button>
              <Button
                title={
                  tab.active
                    ? "Can't discard the active tab"
                    : tab.discarded
                      ? "Tab is already discarded"
                      : "Discard this tab now"
                }
                disabled={!tab.id || tab.active || tab.discarded}
                onClick={async () => {
                  if (!tab.id) return
                  try {
                    await browser.tabs.discard(tab.id)
                  } finally {
                    await refresh()
                  }
                }}
                size="icon"
                variant="ghost"
                className="rounded-[6px] w-8 h-8 outline-none focus-visible:ring-offset-0 focus-visible:ring-0 bg-accent"
              >
                <Moon className="w-4 h-4" />
              </Button>
            </div>
            {matchedRule && (
              <div className="flex justify-end font-mono">
                <span>
                  No.{matchedRule.index}: inactive{" "}
                  {matchedRule.inactive_minutes} minutes to {matchedRule.action}
                </span>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

const ChromeDefaultBlue = "#3871e0"

function Favicon({
  tab,
  className,
}: {
  tab: TTabs.Tab
  className?: ClassValue
}) {
  if (tab.url?.startsWith("chrome://settings/")) {
    return (
      <ChromeSettingsIcon fill={ChromeDefaultBlue} className={cn(className)} />
    )
  }

  if (tab.url === "chrome://extensions/") {
    return (
      <ChromeExtensionIcon fill={ChromeDefaultBlue} className={cn(className)} />
    )
  }

  if (tab.url === "chrome://bookmarks/") {
    return (
      <ChromeBookmarkIcon fill={ChromeDefaultBlue} className={cn(className)} />
    )
  }

  const [fallback, setFallback] = useState(
    tab.favIconUrl === undefined || tab.url?.startsWith("chrome://")
  )

  if (fallback) {
    return (
      <div className={cn(className, "flex items-center justify-center")}>
        <ChromeIcon fill={ChromeDefaultBlue} className="w-5 h-5" />
      </div>
    )
  }

  return (
    <img
      src={tab.favIconUrl}
      className={cn(className)}
      onError={() => {
        setFallback(true)
      }}
    />
  )
}

function TabStatusIndicator({ discarded }: { discarded?: boolean }) {
  let color = "bg-green-500"
  if (discarded) {
    color = "bg-neutral-400"
  }
  return (
    <span
      className={`block h-[5px] w-[5px] shrink-0 ${color} rounded-full`}
    ></span>
  )
}
