import React, {
  ChangeEvent,
  KeyboardEvent,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus } from '@fortawesome/free-solid-svg-icons';

import { Course } from '..';
import { classes, getRandomColor } from '../../utils/misc';
import { ScheduleContext } from '../../contexts';
import { Course as CourseBean } from '../../data/beans';

import './stylesheet.scss';

export type CourseAddProps = {
  className?: string;
};

type SortKey = 'deliveryMode' | 'campus';

type SortFilter = {
  [sortKey in SortKey]: string[];
};

function isSortKey(sortKey: string): sortKey is SortKey {
  switch (sortKey) {
    case 'deliveryMode':
    case 'campus':
      return true;
    default:
      return false;
  }
}

function doesFilterMatchCourse(
  course: CourseBean,
  filter: SortFilter
): boolean {
  return Object.entries(filter).every(([key, tags]) => {
    if (!isSortKey(key)) return true;

    return (
      tags.length === 0 ||
      course.sections.some((section) => {
        const sortValue = section[key];
        if (sortValue == null) return false;

        return tags.includes(sortValue);
      })
    );
  });
}

export default function CourseAdd({
  className,
}: CourseAddProps): React.ReactElement {
  const [{ oscar, desiredCourses, colorMap }, { patchSchedule }] =
    useContext(ScheduleContext);
  const [keyword, setKeyword] = useState('');
  const [filter] = useState<SortFilter>({
    deliveryMode: [],
    campus: [],
  });
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleChangeKeyword = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      let input = e.target.value.trim();
      const results = /^([A-Z]+)(\d.*)$/i.exec(input);
      if (results != null) {
        const [, subject, number] = results as unknown as [
          string,
          string,
          string
        ];
        input = `${subject} ${number}`;
      }
      setKeyword(input);
    },
    []
  );

  const courses = useMemo(() => {
    const results = /^([A-Z]+) ?((\d.*)?)$/i.exec(keyword.toUpperCase());
    if (!results) {
      return [];
    }
    const [, subject, number] = results as unknown as [string, string, string];

    setActiveIndex(0);

    return oscar.courses
      .filter((course) => {
        const keywordMatch =
          course.subject === subject && course.number.startsWith(number);
        const filterMatch = doesFilterMatchCourse(course, filter);
        return keywordMatch && filterMatch;
      })
      .filter((course) => !desiredCourses.includes(course.id));
  }, [oscar, keyword, filter, desiredCourses]);

  const handleAddCourse = useCallback(
    (course: CourseBean) => {
      if (desiredCourses.includes(course.id)) return;
      // Auto-exclusion disabled - all sections enabled by default
      // Clear excludedCrns to ensure all sections are available for combinations
      patchSchedule({
        desiredCourses: [...desiredCourses, course.id],
        colorMap: { ...colorMap, [course.id]: getRandomColor() },
        excludedCrns: [],
      });
      setKeyword('');
      inputRef.current?.focus();
    },
    [desiredCourses, colorMap, inputRef, patchSchedule]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case 'Enter': {
          const course = courses[activeIndex];
          if (course != null) {
            handleAddCourse(course);
          }
          break;
        }
        case 'ArrowDown':
          setActiveIndex(Math.min(activeIndex + 1, courses.length - 1));
          break;
        case 'ArrowUp':
          setActiveIndex(Math.max(activeIndex - 1, 0));
          break;
        default:
          return;
      }
      e.preventDefault();
    },
    [courses, handleAddCourse, activeIndex]
  );

  const activeCourse = courses[activeIndex];

  return (
    <div className={classes('CourseAdd', className)}>
      <div className="add">
        <div className="primary">
          <FontAwesomeIcon
            className={classes('icon', courses.length > 0 && 'active')}
            fixedWidth
            icon={faPlus}
          />
          <div className="keyword-wrapper">
            {activeCourse && (
              <div className={classes('keyword', 'autocomplete')}>
                {activeCourse.id}
              </div>
            )}
            <input
              type="text"
              ref={inputRef}
              value={keyword}
              onChange={handleChangeKeyword}
              className="keyword"
              placeholder="XX 0000"
              onKeyDown={handleKeyDown}
            />
          </div>
        </div>
        {/* Campus and Delivery Mode filters disabled */}
      </div>
      {courses.length > 0 ? (
        courses.map((course) => (
          <Course
            key={course.id}
            className={classes(course === activeCourse && 'active')}
            courseId={course.id}
            onAddCourse={(): void => handleAddCourse(course)}
          />
        ))
      ) : (
        <div className="disclaimer">
          Disclaimer: UIUC Scheduler should be used as general reference only,
          and users are solely responsible for ensuring any information
          including registration restrictions.
        </div>
      )}
    </div>
  );
}
