import React from 'react';

import Banner from '../Banner';

const BANNER_LOCAL_STORAGE_KEY = 'uiuc-scheduler-tutorial-video-banner';
const VIDEO_LINK = 'https://www.youtube.com/watch?v=VIDEO_ID_HERE';

function Content(): React.ReactElement {
  return (
    <span>
      New to UIUC Scheduler?
      <a
        className="bannerButton"
        href={VIDEO_LINK}
        rel="noopener noreferrer"
        target="_blank"
      >
        <b className="buttonText">Watch how it works.</b>
      </a>
    </span>
  );
}

function MobileContent(): React.ReactElement {
  return (
    <span>
      New here?
      <a
        className="bannerButton"
        href={VIDEO_LINK}
        rel="noopener noreferrer"
        target="_blank"
      >
        <b className="buttonText">Watch how it works.</b>
      </a>
    </span>
  );
}

export default function SurveyBanner(): React.ReactElement {
  return (
    <Banner
      localStorageKey={BANNER_LOCAL_STORAGE_KEY}
      content={<Content />}
      mobileContent={<MobileContent />}
    />
  );
}
