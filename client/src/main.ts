import './style.css';
import { buildWsUrl } from './ws-status';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
  throw new Error('Missing #app mount element');
}

const title = document.createElement('h1');
title.textContent = 'Asteroids 3D - M0 Client Scaffold';

const wsStatus = document.createElement('p');
wsStatus.id = 'ws-status';
wsStatus.className = 'status';
wsStatus.setAttribute('role', 'status');
wsStatus.setAttribute('aria-live', 'polite');
wsStatus.textContent = 'WS: connecting...';

const panel = document.createElement('main');
panel.className = 'panel';
panel.append(title, wsStatus);

root.append(panel);

const socket = new WebSocket(buildWsUrl(window.location));

function hasType(data: string, type: string): boolean {
  try {
    const message: unknown = JSON.parse(data);
    return (
      typeof message === 'object' &&
      message !== null &&
      't' in message &&
      (message as { t: unknown }).t === type
    );
  } catch {
    return false;
  }
}

socket.addEventListener('open', () => {
  wsStatus.textContent = 'WS: connected';
});

socket.addEventListener('message', (event: MessageEvent<string>) => {
  if (hasType(event.data, 'hello')) {
    wsStatus.textContent = 'WS: hello received';
  }
});

socket.addEventListener('error', () => {
  wsStatus.textContent = 'WS: error/closed';
});

socket.addEventListener('close', () => {
  wsStatus.textContent = 'WS: error/closed';
});
