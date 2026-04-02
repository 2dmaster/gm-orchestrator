import { useEffect, useRef, useState, useCallback } from 'react';
import type { ServerEvent, ServerEventType } from '../types';

const MAX_BUFFER = 200;
const INITIAL_RETRY_MS = 500;
const MAX_RETRY_MS = 30_000;

type EventCallback = (event: ServerEvent) => void;

export interface UseWebSocketReturn {
  lastEvent: ServerEvent | null;
  isConnected: boolean;
  events: ServerEvent[];
  on: (type: ServerEventType, callback: EventCallback) => () => void;
}

function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

export function useWebSocket(): UseWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<ServerEvent | null>(null);
  const [events, setEvents] = useState<ServerEvent[]>([]);

  const listenersRef = useRef(new Map<ServerEventType, Set<EventCallback>>());
  const wsRef = useRef<WebSocket | null>(null);
  const retryDelayRef = useRef(INITIAL_RETRY_MS);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  const on = useCallback((type: ServerEventType, callback: EventCallback): (() => void) => {
    const map = listenersRef.current;
    if (!map.has(type)) map.set(type, new Set());
    map.get(type)!.add(callback);
    return () => {
      map.get(type)?.delete(callback);
    };
  }, []);

  useEffect(() => {
    unmountedRef.current = false;

    function connect() {
      if (unmountedRef.current) return;

      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmountedRef.current) return;
        setIsConnected(true);
        retryDelayRef.current = INITIAL_RETRY_MS;
      };

      ws.onmessage = (e) => {
        if (unmountedRef.current) return;
        try {
          const event = JSON.parse(e.data) as ServerEvent;
          setLastEvent(event);
          setEvents((prev) => {
            const next = [...prev, event];
            return next.length > MAX_BUFFER ? next.slice(-MAX_BUFFER) : next;
          });
          // Notify typed listeners
          const callbacks = listenersRef.current.get(event.type);
          if (callbacks) {
            for (const cb of callbacks) cb(event);
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (unmountedRef.current) return;
        setIsConnected(false);
        wsRef.current = null;
        // Exponential backoff reconnect
        const delay = retryDelayRef.current;
        retryDelayRef.current = Math.min(delay * 2, MAX_RETRY_MS);
        retryTimerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // onclose will fire after onerror, triggering reconnect
        ws.close();
      };
    }

    connect();

    return () => {
      unmountedRef.current = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on intentional close
        wsRef.current.close();
      }
    };
  }, []);

  return { lastEvent, isConnected, events, on };
}
