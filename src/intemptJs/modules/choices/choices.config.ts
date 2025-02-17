
export const ChoicesConfig = {
  styleDataAttribute: "intemptEditor-style-v2",
  initialStylesRules:`
  *[iwe-hide="true"]{ display: none !important;visibility: hidden !important; opacity: 0 !important;user-select: none !important;pointer-events: none !important;}
  .iwe-text-block{display: block; width: auto;height: auto;padding: 0;margin: 0;font-size: 16px;} 
  .iwe-link{ color: #0080ff; text-decoration: underline;cursor: pointer;}
  .iwe-image-block{}
  .iwe-container-block{display: block;width: 100%;height: 100px;padding: 0; margin: 0;}
  .iwe-product-wrapper{
    display: block;
    width: 100%;
    height: max-content;
    padding: 16px;
    .iwe-container-block{
        display: flex;
        justify-content: center;
        align-items: center;
        .iwe-text-block{
            text-align: center;
            font-weight: 600;
            font-size: 24px;
            line-height: 36px;

        }
    }
  }
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
    height: auto;
    width: auto;
    min-height: 100%;
    padding: 8px;
    border: 2px solid #AEB5CB;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-direction: column;
    min-width: 200px;
    gap: 8px;
    pointer-events: all;
    & [data-iwe-block-enabled=false]{
      display: none !important;
    }
    
    
    
    & > *  {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
    }
    .card_content__image{
        border-radius: 12px;
        border: 1px solid #E8E9ED;
        height: auto;
        width: auto;
        object-fit: cover;
        max-width: 120px;
        justify-self: center;
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
        justify-content: flex-start;
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
.iwe-product-slider {
    --space: 8px;
    --btn-bg: #E8E9ED;
    --colsPerDesktop: 0;
    --colsPerTablet: 0;
    --colsPerMobile: 0;

    --itemsPerView: var(--colsPerDesktop);
    --btn-size: 60px;
    --btn-border-radius: 100%;
    --btn-container-width:calc(100% + var(--btn-size) * 2 + var(--space) * 2);

    display:flex;
    align-items: center;
    justify-content: center;
    gap: var(--space);
    flex-flow: column;
    width: 100%;
    padding: 0 30px;
    .slider {
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        width: calc( (var(--cardWidth) * var(--itemsPerView)) + ( var(--space) * (var(--itemsPerView) - 1)));
        z-index: 2;
        .slider-wrapper {
            overflow: hidden;
            width: 100%;
            z-index: 2;
            .slider-container {
                pointer-events: none;
                display: flex;
                transition: transform 0.3s ease-in-out;
                width: max-content;
                gap: var(--space);
                align-items: center;
                justify-content: flex-start;
                .iwe-product-card{
                    flex:1;
                }
            }
        }
    }
    .buttons-container{
        width: var(--btn-container-width);
        position: absolute;
        display:flex;
        align-items: center;
        justify-content: space-between;
        z-index: 1;
        gap: var(--space);
        button {
            display:flex;
            align-items: center;
            justify-content: center;
            width: var(--btn-size);
            height: var(--btn-size);
            border: none;
            cursor: pointer;
            border-radius: var(--btn-border-radius);
            background-color: var(--btn-bg);
            .btn-img{
                width: 100%;
                height: 100%;
                object-fit: contain;
            }
            &:hover {
                background-color: color-mix(in srgb, var(--btn-bg) 90%, #000000);
            }
            &:disabled {
                filter: grayscale(1) opacity(0.5);
                pointer-events: none;
            }
        }
        &.topRight{
            --btn-size: 40px;
            --btn-border-radius: 8px;
            top: 0;
            width: max-content;
            right: 0;
            translate: calc(100% + var(--space)) 0;
        }
        &.topLeft{
            --btn-size: 40px;
            --btn-border-radius: 8px;
            top: 0;
            width: max-content;
            left: 0;
            translate: calc(-100% - 8px) 0;
        }
        &.bottomLeft{
            --btn-size: 40px;
            --btn-border-radius: 8px;
            bottom: 0;
            width: max-content;
            left: 0;
            translate: calc(-100% - 8px) 0;
        }
        &.bottomRight{
            --btn-size: 40px;
            bottom: 0;
            width: max-content;
            right: 0;
            translate: calc(100% + var(--space)) 0;
        }
    }
    .dots-container {
        display: flex;
        justify-content: center;
        margin-top: 10px;
        gap: 5px;

        .dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background-color: var(--btn-bg);
            cursor: pointer;
            padding: 0;
            box-shadow: none;
            border: none;
        }

        .dot.active {
            background: #333;
        }
    }
    [data-iwe-block-controls-type='bordered']{
            button{
                border: 1px solid #000000;
            }

            .dot{
                border: 1px solid #000000;
            }

    }
    [data-iwe-block-controls-type='noBackground']{
            button{
                background-color: transparent;
                &:hover {
                    background-color: transparent;
                }
            }

    }

    @media only screen and (max-width: 766px) {
        --itemsPerView: var(--colsPerTablet);

    }
    @media only screen and (max-width: 376px) {
        --itemsPerView: var(--colsPerMobile);
    }
}
  `
};
