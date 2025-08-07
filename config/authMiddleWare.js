require("dotenv").config();
const authenticateMiddleWare= async (req, res, next )=>{

 const token= req.headers.authorization;
    if (!token || token !== process.env.AUTH_TOKEN) {
    return res.status(401).json({ message: "Unauthorized" });
  }
    

   next();


}


module.exports= authenticateMiddleWare;