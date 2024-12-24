
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
    &[data-iwe-block-mode='dynamic']{
        .iwe-product-card{
            .card_content__text{
                p{
                    max-width: unset;
                    overflow: unset;
                    text-overflow: unset;
                    white-space: unset;
                    color: transparent;
                    position: relative;
                    &::before, & > *::before  {
                        font-weight: 400;
                        position: absolute;
                        top: 0;
                        color: #0080ff;
                        border-radius: 4px;
                        padding: 0 4px;
                        background-color: color-mix(in srgb, #0080ff 20%, transparent);
                        border: 1px solid #0080ff;
                        white-space: nowrap;
                        display: inline-flex;
                        justify-content: center;
                    }
                }
                [data-iwe-block="product:title"]{
                    &::before{
                        content: 'Product title';
                    }
                }
                [data-iwe-block="product:description"]{
                    &::before{
                        content: 'Product description';
                    }
                }
                [data-iwe-block="product:price_container"]{
                    display: inline-flex;
                    justify-content: center;
                    gap: 4px;
                    [data-iwe-block="product:original_price"]{
                        max-width: 48px;
                        &::before{
                            content: '$0.00';
                            text-decoration-line: line-through !important;
                        }
                    }
                    [data-iwe-block="product:price"]{
                        max-width: 48px;
                        &::before{
                            content: '$0.00';
                        }
                    }
                }
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
    --rowsPerDesktop: 1;
    --rowsPerTablet: 1;
    --rowsPerMobile: 1;
    --itemsPerRow: var(--colsPerDesktop);
    --rows: var(--rowsPerDesktop);
    display: grid;
    grid-template-columns: repeat(var(--itemsPerRow), max-content);
    grid-template-rows: repeat(var(--rows), 1fr);
    justify-content: center;
    gap: 8px;

    @media only screen and (max-width: 766px) {
        --itemsPerRow: var(--colsPerTablet);
        --rows: var(--rowsPerTablet);
    }
    @media only screen and (max-width: 376px) {
        --itemsPerRow: var(--colsPerMobile);
        --rows: var(--rowsPerMobile);
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
        [data-iwe-block="product:original_price"]{
            text-decoration-line: line-through !important;
        }
        [data-iwe-block="product:title"]{
            font-weight: 500
        }
    }
}
  `

};
