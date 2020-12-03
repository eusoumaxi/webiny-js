import { SecurityIdentity } from "@webiny/api-security/types";
import { GraphQLFieldResolver } from "@webiny/handler-graphql/types";
import { hasPermission, NotAuthorizedResponse } from "@webiny/api-security";
import { CmsContext } from "@webiny/api-headless-cms/types";

type ModelCreatableByUserType = {
    createdBy: {
        id: string;
    };
};
type CRUDType = "r" | "w" | "d";
type HasRwdCallableArgsType = {
    permission?: {
        name: string;
        rwd?: CRUDType;
    };
    rwd: CRUDType;
};

const CMS_MANAGE_SETTINGS_PERMISSION = "cms.manage.setting";

export const getCmsManageSettingsPermission = async (context: CmsContext) => {
    return await context.security.getPermission(CMS_MANAGE_SETTINGS_PERMISSION);
};

export const hasEnvironmentPermission = () => {
    return hasPermission(CMS_MANAGE_SETTINGS_PERMISSION);
};

const hasRwd = ({ permission, rwd }: HasRwdCallableArgsType) => {
    if (!permission || !permission.rwd) {
        return false;
    } else if (typeof permission.rwd !== "string") {
        return true;
    }
    return permission.rwd.includes(rwd);
};
export const hasEnvironmentPermissionRwd = (rwd: CRUDType) => {
    return (resolver: GraphQLFieldResolver) => {
        return async (parent, args, context: CmsContext, info) => {
            const permission = await getCmsManageSettingsPermission(context);
            if (!permission || !hasRwd({ permission, rwd })) {
                return new NotAuthorizedResponse();
            }
            return resolver(parent, args, context, info);
        };
    };
};

export const userCanManageModel = (
    identity: SecurityIdentity,
    model: ModelCreatableByUserType
): boolean => {
    return model.createdBy.id === identity.id;
};
