
export const ChoicesConfig = {
  styleDataAttribute: "intemptEditor-style-v2",
  initialStylesRules:`
  *[iwe-hide="true"]{ display: none !important;visibility: hidden !important; opacity: 0 !important;user-select: none !important;pointer-events: none !important;}
  .iwe-text-block{display: block; width: auto;height: auto;padding: 0;margin: 0;font-size: 16px;} 
  .iwe-link{ color: #0080ff; text-decoration: underline;cursor: pointer;}
  .iwe-image-block{}
  .iwe-container-block{display: block;width: 100%;height: 100px;padding: 0; margin: 0;}
  .iwe-product-block {
    &[data-iwe-block-isready='false']{
        filter: grayscale(1) opacity(0.5);
        .card{
            .card_content__image{
                object-fit: fill !important;
            }
        }
    }

    & > *  {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
    }
}
.iwe-product-grid {
    --colsPerDesktop: 0;
    --colsPerTablet: 0;
    --colsPerMobile: 0;
    --itemsPerRow: var(--colsPerDesktop);
   
    display: grid;
    grid-template-columns: repeat(var(--itemsPerRow), max-content);
    grid-template-rows: repeat(var(--rows), 1fr);
    justify-content: center;
    gap: 8px;

    @media only screen and (max-width: 766px) {
        --itemsPerRow: var(--colsPerTablet);
       
    }
    @media only screen and (max-width: 376px) {
        --itemsPerRow: var(--colsPerMobile);
        
    }
}
.iwe-product-card{
    font-weight: inherit;
    font-size: inherit;
    line-height: inherit;
    height: 270px;
    width: 200px;
    border: 2px solid #AEB5CB;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 8px;
    & > *  {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
    }
    .card_content__image{
        border-radius: 12px;
        border: 1px solid #E8E9ED;
        height: 36.545%;
        width: 60%;
        object-fit: fill;
        max-width: 120px;
    }
    .card-button{
        border-radius: 8px;
        background-color: #0080ff;
        padding: 14px 24px;
        color: #ffffff;
        font-size: 16px;
        font-weight: 500;
    }
    .card_content__text{
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        gap: 4px;
        width: 100%;
        p{
            max-width: 180px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 14px;
            line-height: 22px;
            margin:0;
            padding: 0;
            letter-spacing: 0;
            width: 100%;
            text-align: center;
        }
    }
    [data-iwe-block="product:original_price"]{
      text-decoration-line: line-through !important;
    }
    [data-iwe-block="product:title"]{
      font-weight: 500
    }
}
  `
};
