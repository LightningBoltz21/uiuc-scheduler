import React from 'react';
import { faGithub } from '@fortawesome/free-brands-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import { Button } from '..';
import { classes, getFullYear } from '../../utils/misc';
import { DESKTOP_BREAKPOINT } from '../../constants';
import useScreenWidth from '../../hooks/useScreenWidth';

import './stylesheet.scss';

export default function Attribution(): React.ReactElement {
  const mobile = !useScreenWidth(DESKTOP_BREAKPOINT);
  const year = getFullYear();
  return (
    <div className={classes('Attribution')}>
      {!mobile ? (
        <Button href="https://github.com/lightningboltz21/uiuc-scheduler">
          <FontAwesomeIcon fixedWidth icon={faGithub} size="2xl" />
          <span className="githubText">GitHub</span>
        </Button>
      ) : (
        <div />
      )}

      <p>
        Copyright © 2026 Anish Malepati and Aneesh Kalla · Based on original
        work by Jinseo Park, Bits of Good, and the GT Scheduler contributors.
      </p>
      <p>&nbsp;</p>
    </div>
  );
}
