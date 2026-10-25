import Record from '../models/Record.js';
export const notify = (user, subject, message, details = {}) => Record.create({ kind: 'notification', user, subject, message, details });
