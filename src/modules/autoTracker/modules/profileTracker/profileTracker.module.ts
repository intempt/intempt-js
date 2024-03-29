import { getCookie, setCookie } from '../../../../shared/storageHandler.ts'
import { generateId } from '../../../../shared/shared.utils.ts'



type ProfileIdCookie = { profileId: string } | null;

export class ProfileTrackerModule {
  private readonly key = 'profileId';
  /**
   * Duration of the cookie in milliseconds 30 days
   * */
  private readonly maxAge:number;
  constructor() {
    const millisecondsPerSecond  = 1000;
    const secondsPerMinute  = 60;
    const minutesPerHour  = 60;
    const hoursPerDay  = 24;
    const days  = 30;
    this.maxAge = millisecondsPerSecond * secondsPerMinute * minutesPerHour * hoursPerDay * days;
  }


  _getProfileId(){
    const cookie = getCookie(this.key) as ProfileIdCookie;

    const result = !!cookie
      ? cookie
      : this.setProfileId();

    return result[this.key];
  }

  /**
   * Set or Update the profileId cookie,
   * @return { profileId: string }
   * */
  setProfileId(){
    const existingProfileId = getCookie(this.key) as ProfileIdCookie;
    return !!existingProfileId
      ? this._updateExistingProfileId(existingProfileId[this.key])
      : this._initProfileId();
  }

  /**
   * Initialize a new profileId cookie with expiration date
   * @return {profileId: string}
   * */
  private _initProfileId(){
    return setCookie({
      name: this.key,
      value: generateId(),
      maxAge: this.maxAge,
      path: '/',
    });
  }
  /**
   * Update the existing profileId cookie with expiration date
   * @param id - the existing profileId
   * @return {profileId: string}
   * */
  private _updateExistingProfileId(id:string){
    return setCookie({
      name: this.key,
      value: id,
      maxAge: this.maxAge,
      path: '/',
    })
  }


}
