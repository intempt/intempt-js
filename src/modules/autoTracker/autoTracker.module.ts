import { HtmlElementData } from '../../shared/HtmlElementData.ts';

export class AutoTrackerModule {
  constructor() {}

  public init() {
    this.onClick();
    this.onChange();
    this.onSubmit();
  }

  private onClick() {
    document.addEventListener('click', (event) => {
      //event.preventDefault();
      const target = event.target as HTMLElement;
      const data = new HtmlElementData(target);

      console.log('onClick', data);
    });
  }
  private onChange() {
    document.addEventListener('change', (event) => {
      const target = event.target as HTMLElement;
      const data = new HtmlElementData(target);

      console.log('onChange', data);
    });
  }
  private onSubmit() {
    document.addEventListener('submit', (event) => {
      const target = event.target as HTMLElement;
      const data = new HtmlElementData(target);

      console.dir('onSubmit', target);
      console.log('onSubmit', data);
    });
  }




  onViewPage() {}
  onLeavePage() {}
  onSessionStart() {}
  onSessionEnd() {}

  //SessionStart
  //SessionEnd
}
