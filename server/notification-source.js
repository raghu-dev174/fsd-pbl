const { EventEmitter } = require('node:events');

class NotificationSource extends EventEmitter {
  constructor(intervalMs = 2000) {
    super();
    this.intervalMs = intervalMs;
    this.notifications = [];
    this.nextId = 1;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.generate(), this.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  reset() {
    this.stop();
    this.notifications = [];
    this.nextId = 1;
    this.start();
  }

  generate() {
    const generatedAt = Date.now();
    const notification = {
      id: this.nextId++,
      message: `Notification ${this.nextId - 1}: shared real-time update`,
      generatedAt,
      timestamp: new Date(generatedAt).toISOString()
    };
    this.notifications.push(notification);
    if (this.notifications.length > 500) this.notifications.shift();
    this.emit('notification', notification);
    return notification;
  }

  since(id = 0) {
    return this.notifications.filter((item) => item.id > id);
  }
}

module.exports = { NotificationSource };
