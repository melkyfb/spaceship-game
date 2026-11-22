import './style.css';

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
wsStatus.textContent = 'WS: placeholder (conexão wired na Task 3)';

const panel = document.createElement('main');
panel.className = 'panel';
panel.append(title, wsStatus);

root.append(panel);
