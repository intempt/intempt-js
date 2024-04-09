
export const ChoicesConfig = {
  styleDataAttribute: "intemptEditor-style-v2",
  intemptId: (id:string) => `intempt-id-${id}`,
  initialStylesRules: `
.ve-sdk-col { height: 100px; padding: 10px; width: 100%;}
.ve-sdk-col2, 
.ve-sdk-col3, 
.ve-sdk-col3-7 { width: 100%; height: 100px; display: flex; justify-content: center; align-items: center; gap: 10px; padding:10px; }
.ve-sdk-col__child {flex:1; min-height: 100%;}
.ve-sdk-col__child-3-7:first-child {flex:.3;}
.ve-sdk-col__child-3-7 {flex:.7; min-height: 100%;}
.ve-sdk-text { min-height: min-content; min-width: min-content; margin: 0; }
.ve-sdk-text_section { min-height: min-content; padding: 10px; width: 100%; display: flex; flex-flow: column; align-items: center; justify-content: center; gap: 10px; }
.ve-sdk-link, a.ve-sdk-link { color:#0070E0; min-height: min-content; min-width: min-content;text-decoration: underline; }
.ve-sdk-link-text, a.ve-sdk-link-text { font-size:inherit;text-decoration: underline;color:#0070E0;}
.ve-sdk-link_block > *, a.ve-sdk-link_block > * {width: 100%; height: 100%;}
.ve-sdk-link_wrapper { display: block;text-decoration: underline; color:#0070E0;}
a.ve-sdk-link_wrapper{ text-decoration: underline; color:#0070E0;}
.ve-sdk-img {border: none;height: auto;width: auto;display: block; outline: none;object-fit: cover;cursor: pointer;outline-offset: -2px;}
.ve-sdk-video {aspect-ratio:16/9;height:100%;width:100%}
.ve-sdk-code {min-height: 100px; padding: 10px; width: 100%; display: block; }
`,
};
