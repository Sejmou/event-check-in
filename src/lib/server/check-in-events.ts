import { EventEmitter } from 'node:events';

export type CheckInEvent = { id: string; firstName: string; lastName: string; at: number };

/**
 * Fans each new check-in out to the open check-in screens, so a name nobody at
 * the door recognises shows up while its owner is still in the room.
 *
 * ponytail: in-process, like the throttle. One box at one event; a second
 * instance would need something like Postgres LISTEN or Redis pub/sub.
 */
const emitter = new EventEmitter().setMaxListeners(0);

export function publishCheckIn(event: CheckInEvent) {
	emitter.emit('check-in', event);
}

export function onCheckIn(listener: (event: CheckInEvent) => void) {
	emitter.on('check-in', listener);
	return () => void emitter.off('check-in', listener);
}
