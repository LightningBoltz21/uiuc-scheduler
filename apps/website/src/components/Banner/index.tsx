import React from 'react';
import useLocalStorageState from 'use-local-storage-state';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import Button from '../Button';
import { DESKTOP_BREAKPOINT } from '../../constants';
import useScreenWidth from '../../hooks/useScreenWidth';
import { classes } from '../../utils/misc';

import './stylesheet.scss';

type BannerProps = {
  localStorageKey: string;
  content: React.ReactElement;
  mobileContent?: React.ReactElement;
  // Additional class on the root element,
  // so that a consumer can restyle the bar without affecting the others
  className?: string;
  // Optional action rendered between the content and the dismiss button
  action?: React.ReactElement;
  // Accessible name for the dismiss button
  dismissLabel?: string;
};

export default function Banner({
  localStorageKey,
  content,
  mobileContent,
  className,
  action,
  dismissLabel,
}: BannerProps): React.ReactElement {
  const [hasSeen, setHasSeen] = useLocalStorageState(localStorageKey, {
    defaultValue: false,
    storageSync: true,
  });
  const mobile = !useScreenWidth(DESKTOP_BREAKPOINT);

  if (hasSeen) return <div />;

  return (
    <div className={classes('banner', className)}>
      <div className="spacer" />
      {!mobile ? content : mobileContent || content}
      {action}
      <Button
        className="close-button"
        aria-label={dismissLabel ?? 'Dismiss'}
        onClick={(): void => {
          setHasSeen(true);
        }}
      >
        <FontAwesomeIcon fixedWidth icon={faXmark} size="lg" />
      </Button>
    </div>
  );
}
