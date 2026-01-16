import React, { useState } from 'react';
import { faAngleDown, faAngleUp } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import { classes, humanizeArrayReact } from '../../utils/misc';

import './stylesheet.scss';

export type CourseFilterProps = {
  name: string;
  labels: Record<string, string>;
  selectedTags: string[];
  onReset: () => void;
  onToggle: (tag: string) => void;
  disabled?: boolean;
};

export default function CourseFilter({
  name,
  labels,
  selectedTags,
  onReset,
  onToggle,
  disabled = false,
}: CourseFilterProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={classes('CourseFilter', disabled && 'disabled')}>
      <div
        className={classes('header', selectedTags.length > 0 && 'active')}
        onClick={disabled ? undefined : (): void => setExpanded(!expanded)}
      >
        {!expanded && selectedTags.length > 0 ? (
          <div className="name">
            {humanizeArrayReact(
              selectedTags.flatMap<string>((tag) => {
                const selectedTag = labels[tag];
                return selectedTag != null ? [selectedTag] : [];
              }),
              <span className="or">or</span>
            )}
          </div>
        ) : (
          <div className="name">{name}</div>
        )}
        <FontAwesomeIcon fixedWidth icon={expanded ? faAngleUp : faAngleDown} />
      </div>
      {expanded && (
        <div className="tag-container">
          <div
            className={classes('tag', selectedTags.length === 0 && 'active')}
            onClick={onReset}
          >
            All
          </div>
          {Object.keys(labels).map((tag) => (
            <div
              key={tag}
              className={classes('tag', selectedTags.includes(tag) && 'active')}
              onClick={(): void => onToggle(tag)}
            >
              {labels[tag]}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
