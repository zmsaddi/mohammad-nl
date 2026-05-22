import { redirect } from 'next/navigation';

export default function Home() {
  // Every role redirects to /summary, which serves a role-appropriate view:
  // admin/manager get the full dashboard, sellers and drivers get their own
  // personal panels (the summary API branches on role). No middleware needed.
  redirect('/summary');
}
