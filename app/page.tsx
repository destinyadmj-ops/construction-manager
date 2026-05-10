import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import HomeMobileRedirect from './home-mobile-redirect';
import WeekHub from './week-hub';

function isMobileUserAgent(userAgent: string) {
  return /android|iphone|ipad|ipod|mobile/i.test(userAgent);
}

function isMobileClientHint(value: string) {
  const normalized = value.trim();
  return normalized === '?1' || normalized === '1';
}

export default async function Home() {
  const headerList = await headers();
  const userAgent = headerList.get('user-agent') ?? '';
  const clientHint = headerList.get('sec-ch-ua-mobile') ?? '';
  if (isMobileUserAgent(userAgent) || isMobileClientHint(clientHint)) {
    redirect('/mobile/week-hub');
  }

  return (
    <>
      <HomeMobileRedirect />
      <WeekHub />
    </>
  );
}
