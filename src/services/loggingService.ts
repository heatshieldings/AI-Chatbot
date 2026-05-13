import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase';

export interface ErrorLog {
  code: string;
  message: string;
  details: string;
  timestamp: any;
  userId?: string;
  userEmail?: string;
  path?: string;
}

export async function logErrorToFirebase(code: string, message: string, originalError: any) {
  try {
    const errorData: ErrorLog = {
      code,
      message,
      details: originalError instanceof Error ? originalError.stack || originalError.message : String(originalError),
      timestamp: serverTimestamp(),
      userId: auth.currentUser?.uid,
      userEmail: auth.currentUser?.email,
      path: window.location.pathname
    };

    await addDoc(collection(db, 'error_reports'), errorData);
    console.log(`[Logged to Firestore] Error ${code}: ${message}`);

    // New: Trigger email report via backend API
    fetch('/api/report-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(errorData)
    }).catch(err => console.error("Failed to trigger email report:", err));

  } catch (err) {
    console.error("Failed to log error to Firebase:", err);
  }
}
