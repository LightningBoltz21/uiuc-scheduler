import React, { useCallback, useContext, useId, useState } from 'react';
import { Tooltip as ReactTooltip } from 'react-tooltip';
import {
  faBan,
  faChair,
  faThumbtack,
  faTimes,
} from '@fortawesome/free-solid-svg-icons';

import { classes, periodToString } from '../../utils/misc';
import { ActionRow } from '..';
import { OverlayCrnsContext, ScheduleContext } from '../../contexts';
import { DELIVERY_MODES } from '../../constants';
import { Section as SectionBean } from '../../data/beans';
import { Seating } from '../../data/beans/Section';
import { ErrorWithFields, softError } from '../../log';

import './stylesheet.scss';

export type SectionProps = {
  className?: string;
  section: SectionBean;
  pinned: boolean;
  color: string | undefined;
};

export default function Section({
  className,
  section,
  pinned,
  color,
}: SectionProps): React.ReactElement {
  const [{ term, pinnedCrns, excludedCrns }, { patchSchedule }] =
    useContext(ScheduleContext);
  const [, setOverlayCrns] = useContext(OverlayCrnsContext);
  const [seating, setSeating] = useState<Seating>([[], 0]);

  let hovering = false;
  const handleHover = (): void => {
    hovering = true;
    setTimeout(() => {
      if (hovering) {
        section
          .fetchSeating(term)
          .then((newSeating) => {
            setSeating(newSeating);
          })
          .catch((err) =>
            softError(
              new ErrorWithFields({
                message: 'error while fetching seating',
                source: err,
                fields: { crn: section.crn, term: section.term },
              })
            )
          );
      }
    }, 333);
  };

  const excludeSection = useCallback(
    (sect: SectionBean) => {
      patchSchedule({
        excludedCrns: [...excludedCrns, sect.crn],
        pinnedCrns: pinnedCrns.filter((crn) => crn !== sect.crn),
      });
    },
    [pinnedCrns, excludedCrns, patchSchedule]
  );

  const pinSection = useCallback(
    (sect: SectionBean) => {
      if (pinnedCrns.includes(sect.crn)) {
        patchSchedule({
          pinnedCrns: pinnedCrns.filter((crn) => crn !== sect.crn),
        });
      } else {
        patchSchedule({
          pinnedCrns: [...pinnedCrns, sect.crn],
          excludedCrns: excludedCrns.filter((crn) => crn !== sect.crn),
        });
      }
    },
    [pinnedCrns, excludedCrns, patchSchedule]
  );

  const excludeTooltipId = useId();
  const sectionTooltipId = useId();
  return (
    <ActionRow
      label={
        <div className="section-label">
          <span className="section-id">{section.id}</span>
          <span className="schedule-type">{section.scheduleType}</span>
        </div>
      }
      className={classes('Section', className)}
      onMouseEnter={(): void => setOverlayCrns([section.crn])}
      onMouseLeave={(): void => setOverlayCrns([])}
      actions={[
        {
          icon: pinned ? faTimes : faThumbtack,
          onClick: (): void => pinSection(section),
        },
        {
          icon: faChair,
          id: sectionTooltipId,
          href: `https://courses.illinois.edu/schedule/terms/${
            section.course.id.split(' ')[0] ?? ''
          }/${section.crn}`,
        },
        {
          icon: faBan,
          id: excludeTooltipId,
          tooltip: 'Exclude from Combinations',
          onClick: (): void => excludeSection(section),
        },
      ]}
      style={pinned ? { backgroundColor: color } : undefined}
    >
      <div className="section-details">
        <div className="delivery-mode">
          {section.deliveryMode != null
            ? DELIVERY_MODES[section.deliveryMode]
            : ''}
        </div>
        <div className="meeting-container">
          {section.meetings.map((meeting, i) => {
            return (
              <div className="meeting" key={i}>
                <span className="days">{meeting.days.join('')}</span>
                <span className="period">{periodToString(meeting.period)}</span>
              </div>
            );
          })}
        </div>

        <ReactTooltip
          anchorId={sectionTooltipId}
          className="tooltip"
          variant="dark"
          place="top"
          afterShow={(): void => handleHover()}
          afterHide={(): void => {
            hovering = false;
          }}
        >
          {seating[0].length === 0 ? (
            `Loading availability...`
          ) : typeof seating[0][0] === 'number' ? (
            <div>
              <b>Status: </b>
              <span
                style={{
                  color:
                    seating[0][0] === 1
                      ? '#4ade80'
                      : seating[0][0] === 0
                      ? '#f87171'
                      : '#fb923c',
                  fontWeight: 'bold',
                }}
              >
                {((section as unknown as Record<string, unknown>)[
                  'availabilityText'
                ] as string | undefined) || 'Unknown'}
              </span>
            </div>
          ) : (
            `Availability: N/A`
          )}
        </ReactTooltip>
      </div>
    </ActionRow>
  );
}
