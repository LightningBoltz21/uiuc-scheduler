import React, { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCommentAlt, faTimes } from '@fortawesome/free-solid-svg-icons';

import { Button } from '..';

import './stylesheet.scss';

const GITHUB_ISSUES_URL =
  'https://github.com/lightningboltz21/uiuc-scheduler/issues/new/choose';

export default function Feedback(): React.ReactElement {
  const [expanded, setExpanded] = useState<boolean>(false);

  return (
    <>
      {!expanded && (
        <div className="FeedbackButtonWrapper">
          <Button
            className="FeedbackButton"
            onClick={(): void => setExpanded(true)}
          >
            <FontAwesomeIcon icon={faCommentAlt} size="2x" />
          </Button>
        </div>
      )}
      {expanded && (
        <div>
          <div className="FeedbackForm">
            <div className="container">
              <FontAwesomeIcon
                icon={faTimes}
                className="CloseIcon"
                onClick={(): void => setExpanded(false)}
              />
              <h3 className="FeedbackTitle">Feedback</h3>
              <p className="text">Found a bug or have a feature request?</p>
              <Button
                className="SubmitButton"
                onClick={(): void => {
                  window.open(GITHUB_ISSUES_URL, '_blank');
                }}
              >
                Open GitHub Issue
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
