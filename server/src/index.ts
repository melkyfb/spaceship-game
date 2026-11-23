import { join } from 'node:path';
import { LeaderboardStore } from './LeaderboardStore';
import { RoomManager } from './RoomManager';
import { createWebSocketServer } from './ws-server';

const PORT = 8080;
const leaderboardDbPath = join(import.meta.dirname, '..', 'data', 'leaderboard.db');
const leaderboardStore = new LeaderboardStore(leaderboardDbPath);
const roomManager = new RoomManager({ leaderboardStore });

createWebSocketServer(PORT, { roomManager });
