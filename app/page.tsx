import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import WeekHub from './week-hub';

function isMobileUserAgent(userAgent: string) {
  return /android|iphone|ipad|ipod|mobile/i.test(userAgent);
}

export default async function Home() {
  const headerList = await headers();
  const userAgent = headerList.get('user-agent') ?? '';
  if (isMobileUserAgent(userAgent)) {
    redirect('/mobile/week-hub');
  }

  return <WeekHub />;
}
