import { redirect } from 'next/navigation';

// "New Orders" was merged into the unified Inbox (Needs Action tab). Keep the old
// route alive so existing bookmarks/deep links resolve.
export default function NewOrdersRedirect() {
  redirect('/inbox');
}
