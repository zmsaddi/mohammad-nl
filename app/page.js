import { redirect } from 'next/navigation';

export default function Home() {
  // Middleware handles role-based redirect
  redirect('/summary');
}
