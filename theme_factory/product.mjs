const SAFE=/^[a-z0-9][a-z0-9_-]{0,63}$/;
export function validateProduct(input){
 if(!input||typeof input!=="object")throw Error("product object required");
 const {slug,title,description,wallpapers,icons=[]}=input;
 if(typeof slug!=="string"||!SAFE.test(slug))throw Error("invalid slug");
 if(typeof title!=="string"||!title.trim()||title.length>120)throw Error("invalid title");
 if(typeof description!=="string"||!description.trim()||description.length>3000)throw Error("invalid description");
 if(!Array.isArray(wallpapers)||wallpapers.length<1||wallpapers.length>30)throw Error("wallpapers required (1-30)");
 if(!Array.isArray(icons)||icons.length>200)throw Error("invalid icons");
 const paths=new Set();
 for(const asset of [...wallpapers,...icons]){
  if(!asset||typeof asset!=="object"||typeof asset.file!=="string"||!/^assets\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.(png|jpg|jpeg|webp)$/.test(asset.file)||paths.has(asset.file))throw Error("unsafe or duplicate asset path");
  paths.add(asset.file);
  if(!Number.isInteger(asset.width)||!Number.isInteger(asset.height)||asset.width<1||asset.height<1)throw Error("invalid asset dimensions");
 }
 return {slug,title:title.trim(),description:description.trim(),wallpapers,icons};
}
export function storefrontListing(product){
 const p=validateProduct(product);
 return {slug:p.slug,title:p.title,description:p.description,assetCount:p.wallpapers.length+p.icons.length,keywords:["wallpaper","mobile theme",p.slug.replaceAll("-"," ")],license:"personal-use",publicationStatus:"draft"};
}
