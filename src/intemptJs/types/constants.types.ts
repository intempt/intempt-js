export enum IntemptEventName {
  PAGE_LEAVE = "Leave Page",
  PAGE_VIEW = "View Page",
  CLICK_ON = "Click On",
  SUBMIT_ON = "Submit On",
  CHANGE_ON = "Change On",
  SESSION_START = "Session Start",
  PRODUCT_VIEW = "Product viewed",
  PRODUCT_ADD = "Added to cart",
  PRODUCT_ORDER = "Product ordered",
}

export enum UtmKey {
  CAMPAIGN = "utm_campaign",
  CONTENT = "utm_content",
  MEDIUM = "utm_medium",
  SOURCE = "utm_source",
  TERM = "utm_term",
}

export enum DeviceTypeName {
  DESKTOP = "Desktop",
  MOBILE = "Mobile",
  TABLET = "Tablet",
  DEFAULT = "Not Recognized",
}

export enum IntemptDomEventName {
  CLICK = "click",
  SUBMIT = "submit",
  CHANGE = "change",
  INPUT = "input",
  KEYUP = "keyup"
}

export enum IntemptEventListenerName {
  PAGE = "intempt:page",
  EVENT = "intempt:event",
  HTML = "intempt:html",
  SESSION = "intempt:session",
  SHOPIFY = "intempt:shopify",
  PRODUCT = 'intempt:product'
}
