import { generateId } from '../../shared/shared.utils.ts'


export class SessionTrackerModule {
  id:string;
  startTime?: number;
  _endTime?: number;
  _lastActionTime?: number;
  _duration?: number;


  private readonly _defaultSessionTimeWithoutActivity: number;
  private readonly _minutesStep = 3;
  private readonly _secondsStep = 60;
  private readonly _millisecondsStep = 1000;

  constructor() {
    this.id = generateId();
    this._defaultSessionTimeWithoutActivity = this._minutesStep * this._secondsStep * this._millisecondsStep;




  }





  init() {
    console.log(this.id)
    console.log(this.startTime);
  }

  isValidSession(start:number, lastActivity:number) {
    return lastActivity - start < this._defaultSessionTimeWithoutActivity;
  }

  setStartTime() {}
  setEndTime() {}
  updateLastActionTime() {}
}
/**
 * Clicks: click event
 * Keypress: keypress or keydown event
 * Mouse movement: mousemove event
 * Touch events: touchstart, touchmove, touchend, etc.
 * Form submissions: submit event
 * Focus changes: focus and blur events
 * Scroll events: scroll event
 * Drag and drop: dragstart, drag, dragend, etc.
 * Selection changes: select event
 * Pointer events: pointerdown, pointermove, pointerup, etc.
 *
 * */
