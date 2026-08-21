// src/lib/badges.js
//
// One source of truth for "is there anything waiting on me?", per tab.
//
// Every tab that can accumulate work gets a dot: things you sent that are
// still undecided, and things sent to you that need your decision. Both count,
// because both are unfinished business from the user's point of view — a
// manager wants to know their team is waiting, and an employee wants to know
// their own request has not moved.
//
// A DOT, not a number. A count on a tab icon has to be legible at 8pt, which
// forces a pill wide enough to cover the icon it is attached to; and the exact
// number does not change what you do — you open the tab either way. The dot
// says "something", the screen says what.
//
// Refresh policy: on mount, on app foreground, and every 90s while open.
// Polling is cheap here (three small authenticated GETs) and the alternative
// is a socket subscription for a dot.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { useAuth } from "../context/AuthContext";
import { getApiUrl } from "./api";

const REFRESH_MS = 90_000;

const BadgeContext = createContext({ badges: {}, refreshBadges: () => {} });

/** Truthy count of items in a list matching any of the given statuses. */
function countBy(list, statuses) {
  if (!Array.isArray(list)) return 0;
  return list.filter((x) => statuses.includes(x?.status)).length;
}

export function BadgeProvider({ children }) {
  const { apiFetch, user } = useAuth();
  const [badges, setBadges] = useState({});
  const timer = useRef(null);

  const load = useCallback(async () => {
    if (!user) return;

    // Every call is allowed to fail on its own. A dot is never worth an error
    // state, and one dead endpoint must not blank the others.
    const get = async (path) => {
      try {
        const r = await apiFetch(getApiUrl(path));
        return r?.success ? r.data || [] : [];
      } catch {
        return [];
      }
    };

    const [leaveMine, leaveTeam, otMine, otTeam, regMine, regTeam, docsMine] =
      await Promise.all([
        get("/leave-applications"),
        get("/leave-applications/manager/pending"),
        get("/overtime/my"),
        get("/overtime/manager/pending"),
        get("/regularizations"),
        get("/regularizations/manager/pending"),
        // The EMPLOYEE-facing documents list, which already excludes anything
        // HR has generated but not released. Never point this at an /api/hr/*
        // route: the badge context holds an employee token, and a count is
        // still a disclosure — it would leak the existence of a hidden letter.
        get("/documents"),
      ]);

    // "requested" is the documents module's open state. It is inert for the
    // other five lists, so one shared array stays correct.
    const OPEN = ["pending", "manager_approved", "submitted", "pm_approved", "requested"];

    const work =
      countBy(leaveMine, OPEN) +
      countBy(otMine, OPEN) +
      countBy(regMine, OPEN) +
      countBy(docsMine, OPEN) +
      (Array.isArray(leaveTeam) ? leaveTeam.length : 0) +
      (Array.isArray(otTeam) ? otTeam.length : 0) +
      (Array.isArray(regTeam) ? regTeam.length : 0);

    // Work only. Home is where the app opens, so a dot there is showing on
    // the tab the user is already looking at — it flags nothing they cannot
    // already see, and a permanent dot on the default tab stops meaning
    // anything at all.
    setBadges({ Work: work });
  }, [apiFetch, user]);

  useEffect(() => {
    if (!user) {
      setBadges({});
      return undefined;
    }
    load();
    timer.current = setInterval(load, REFRESH_MS);

    // Coming back from the background is the moment a stale dot is most
    // obvious — a manager approves on the CMS, then opens the app.
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") load();
    });

    return () => {
      if (timer.current) clearInterval(timer.current);
      sub?.remove?.();
    };
  }, [user, load]);

  return (
    <BadgeContext.Provider value={{ badges, refreshBadges: load }}>
      {children}
    </BadgeContext.Provider>
  );
}

export function useBadges() {
  return useContext(BadgeContext);
}

export default BadgeProvider;
