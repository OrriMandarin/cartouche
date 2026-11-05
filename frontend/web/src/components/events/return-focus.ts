import type { RefObject } from "react";

/**
 * `onCloseAutoFocus` handler of a dialog opened by state, without a Radix trigger: gives the focus back to the
 * control that opened it, which Radix cannot find by itself.
 */
export function returnFocus(target: RefObject<HTMLElement | null> | undefined) {
  return (event: Event) => {
    if (target?.current == null) return;
    event.preventDefault();
    target.current.focus();
  };
}
