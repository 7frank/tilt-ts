##

### tiltfile.ts import

- file cant be imported in compiled artifact due to ts extension not registered
- we will cirumvent this by having a small compile step beforehand

  - see "compile" script

###

- other than that the state seems not to contain the resources and will not run properly on compiled example
- did we break the impl?
  - git bisect?
  - "br up"
