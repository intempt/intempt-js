import { getCookie, setCookie } from '../../../../../shared/storageHandler.ts'
import { generateId } from '../../../../../shared/shared.utils.ts'



type ProfileIdCookie = { profileId: string } | null;

export class ProfileTrackerModule {
  private readonly keys = ['profileId'];

  private readonly profileId = 'profileId';
  /**
   * Duration of the cookie in milliseconds 30 days
   * */
  private readonly expiration:number;
  constructor() {
    const millisecondsPerSecond  = 1000;
    const secondsPerMinute  = 60;
    const minutesPerHour  = 60;
    const hoursPerDay  = 24;
    const days  = 30;
    this.expiration = millisecondsPerSecond * secondsPerMinute * minutesPerHour * hoursPerDay * days;
  }

  get cookieKeys(){
    return this.keys;
  }


  init(){
    this.setProfileId();
  }

   getId(){
    const cookie = getCookie(this.profileId) as ProfileIdCookie;

    const result = !!cookie
      ? cookie
      : this.setProfileId();

    return result[this.profileId];
  }

  /**
   * Set or Update the profileId cookie,
   * @return { profileId: string }
   * */
  setProfileId(){
    const existingProfileId = getCookie(this.profileId) as ProfileIdCookie;
    return !!existingProfileId
      ? this._updateExistingProfileId(existingProfileId[this.profileId])
      : this._initProfileId();
  }

  /**
   * Initialize a new profileId cookie with expiration date
   * @return {profileId: string}
   * */
  private _initProfileId(){
    return setCookie({
      name: this.profileId,
      value: generateId(),
      expiration: this.expiration,
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
      name: this.profileId,
      value: id,
      expiration: this.expiration,
      path: '/',
    })
  }


}
