import { getDatabase } from 'firebase/database';
import { getStorage } from 'firebase/storage';
import { getAuth } from 'firebase/auth';
import { app } from './firebase-app.js';

export { app };
export const db = getDatabase(app);
export const storage = getStorage(app);
export const auth = getAuth(app);
