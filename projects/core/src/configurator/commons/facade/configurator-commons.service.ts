import { Injectable } from '@angular/core';
import { select, Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { filter, map, take, tap } from 'rxjs/operators';
import { ActiveCartService } from '../../../cart/facade/active-cart.service';
import { Cart } from '../../../model/cart.model';
import { Configurator } from '../../../model/configurator.model';
import { GenericConfigurator } from '../../../model/generic-configurator.model';
import {
  OCC_USER_ID_ANONYMOUS,
  OCC_USER_ID_CURRENT,
} from '../../../occ/utils/occ-constants';
import * as ConfiguratorActions from '../store/actions/configurator.action';
import { StateWithConfiguration } from '../store/configuration-state';
import * as ConfiguratorSelectors from '../store/selectors/configurator.selector';

@Injectable()
export class ConfiguratorCommonsService {
  constructor(
    protected store: Store<StateWithConfiguration>,
    protected activeCartService: ActiveCartService
  ) {}

  public hasPendingChanges(
    owner: GenericConfigurator.Owner
  ): Observable<Boolean> {
    return this.store.pipe(
      select(ConfiguratorSelectors.hasPendingChanges(owner.key))
    );
  }

  public configurationIsLoading(
    owner: GenericConfigurator.Owner
  ): Observable<Boolean> {
    return this.store.pipe(
      select(
        ConfiguratorSelectors.getConfigurationProcessLoaderStateFactory(
          owner.key
        )
      ),
      map((configurationState) => configurationState.loading)
    );
  }

  public getConfiguration(
    owner: GenericConfigurator.Owner
  ): Observable<Configurator.Configuration> {
    return this.store.pipe(
      select(ConfiguratorSelectors.getConfigurationFactory(owner.key)),
      filter((configuration) => this.isConfigurationCreated(configuration))
    );
  }

  public getOrCreateConfiguration(
    owner: GenericConfigurator.Owner
  ): Observable<Configurator.Configuration> {
    const localOwner: GenericConfigurator.Owner = {
      hasObsoleteState: owner.hasObsoleteState,
    };

    return this.store.pipe(
      select(
        ConfiguratorSelectors.getConfigurationProcessLoaderStateFactory(
          owner.key
        )
      ),
      tap((configurationState) => {
        if (
          (!this.isConfigurationCreated(configurationState.value) ||
            localOwner.hasObsoleteState === true) &&
          configurationState.loading !== true &&
          configurationState.error !== true
        ) {
          if (owner.type === GenericConfigurator.OwnerType.PRODUCT) {
            this.store.dispatch(
              new ConfiguratorActions.CreateConfiguration(owner)
            );
          } else {
            localOwner.hasObsoleteState = false;
            this.readConfigurationForCartEntry(owner);
          }
        }
      }),
      filter((configurationState) =>
        this.isConfigurationCreated(configurationState.value)
      ),
      map((configurationState) => configurationState.value)
    );
  }

  public readConfigurationForCartEntry(owner: GenericConfigurator.Owner) {
    this.activeCartService.requireLoadedCart().subscribe((cartState) => {
      const readFromCartEntryParameters: GenericConfigurator.ReadConfigurationFromCartEntryParameters = {
        userId: this.getUserId(cartState.value),
        cartId: this.getCartId(cartState.value),
        cartEntryNumber: owner.id,
        owner: owner,
      };
      this.store.dispatch(
        new ConfiguratorActions.ReadCartEntryConfiguration(
          readFromCartEntryParameters
        )
      );
    });
  }

  public updateConfiguration(
    ownerKey: string,
    groupId: string,
    changedAttribute: Configurator.Attribute
  ): void {
    this.store
      .pipe(
        select(ConfiguratorSelectors.getConfigurationFactory(ownerKey)),
        take(1)
      )
      .subscribe((configuration) => {
        this.store.dispatch(
          new ConfiguratorActions.UpdateConfiguration(
            this.createConfigurationExtract(
              groupId,
              changedAttribute,
              configuration
            )
          )
        );
      });
  }

  public getConfigurationWithOverview(
    configuration: Configurator.Configuration
  ) {
    this.store.dispatch(
      new ConfiguratorActions.GetConfigurationOverview(configuration)
    );

    return this.store.pipe(
      select(
        ConfiguratorSelectors.getConfigurationFactory(configuration.owner.key)
      )
    );
  }

  public removeConfiguration(owner: GenericConfigurator.Owner) {
    this.store.dispatch(
      new ConfiguratorActions.RemoveConfiguration({ ownerKey: owner.key })
    );
  }

  public addToCart(productCode: string, configId: string, ownerKey: string) {
    this.activeCartService.requireLoadedCart().subscribe((cartState) => {
      const addToCartParameters: Configurator.AddToCartParameters = {
        userId: this.getUserId(cartState.value),
        cartId: this.getCartId(cartState.value),
        productCode: productCode,
        quantity: 1,
        configId: configId,
        ownerKey: ownerKey,
      };
      this.store.dispatch(
        new ConfiguratorActions.AddToCart(addToCartParameters)
      );
    });
  }

  public updateCartEntry(configuration: Configurator.Configuration) {
    this.activeCartService.requireLoadedCart().subscribe((cartState) => {
      const parameters: Configurator.UpdateConfigurationForCartEntryParameters = {
        userId: this.getUserId(cartState.value),
        cartId: this.getCartId(cartState.value),
        cartEntryNumber: configuration.owner.id,
        configuration: configuration,
      };

      this.store.dispatch(new ConfiguratorActions.UpdateCartEntry(parameters));
      this.checkForUpdateDone(configuration).subscribe((configAfterUpdate) => {
        this.readConfigurationForCartEntry(configAfterUpdate.owner);
      });
    });
  }

  checkForUpdateDone(
    configuration: Configurator.Configuration
  ): Observable<Configurator.Configuration> {
    return this.store.pipe(
      select(
        ConfiguratorSelectors.getConfigurationFactory(configuration.owner.key)
      ),
      filter(
        (configInUpdate) => configInUpdate.isCartEntryUpdatePending === false
      ),
      take(1)
    );
  }

  ////
  // Helper methods
  ////
  getCartId(cart: Cart): string {
    return cart.user.uid === OCC_USER_ID_ANONYMOUS ? cart.guid : cart.code;
  }

  getUserId(cart: Cart): string {
    return cart.user.uid === OCC_USER_ID_ANONYMOUS
      ? cart.user.uid
      : OCC_USER_ID_CURRENT;
  }

  isConfigurationCreated(configuration: Configurator.Configuration): boolean {
    const configId: String = configuration?.configId;
    return configId !== undefined && configId.length !== 0;
  }

  createConfigurationExtract(
    groupId: string,
    changedAttribute: Configurator.Attribute,
    configuration: Configurator.Configuration
  ): Configurator.Configuration {
    const newConfiguration: Configurator.Configuration = {
      configId: configuration.configId,
      groups: [],
      owner: configuration.owner,
      productCode: configuration.productCode,
    };

    const groupPath: Configurator.Group[] = [];
    this.buildGroupPath(groupId, configuration.groups, groupPath);
    const groupPathLength = groupPath.length;
    if (groupPathLength === 0) {
      throw new Error(
        'At this point we expect that group is available in the configuration: ' +
          groupId +
          ', ' +
          JSON.stringify(configuration.groups.map((cGroup) => cGroup.id))
      );
    }
    let currentGroupInExtract: Configurator.Group = this.buildGroupForExtract(
      groupPath[groupPathLength - 1]
    );
    let currentLeafGroupInExtract: Configurator.Group = currentGroupInExtract;
    newConfiguration.groups.push(currentGroupInExtract);

    for (let index = groupPath.length - 1; index > 0; index--) {
      currentLeafGroupInExtract = this.buildGroupForExtract(
        groupPath[index - 1]
      );
      currentGroupInExtract.subGroups = [currentLeafGroupInExtract];
      currentGroupInExtract = currentLeafGroupInExtract;
    }

    currentLeafGroupInExtract.attributes = [changedAttribute];
    return newConfiguration;
  }

  buildGroupForExtract(group: Configurator.Group): Configurator.Group {
    const changedGroup: Configurator.Group = {
      groupType: group.groupType,
      id: group.id,
    };
    return changedGroup;
  }

  buildGroupPath(
    groupId: string,
    groupList: Configurator.Group[],
    groupPath: Configurator.Group[]
  ): boolean {
    let haveFoundGroup = false;
    const group: Configurator.Group = groupList.find(
      (currentGroup) => currentGroup.id === groupId
    );

    if (group) {
      groupPath.push(group);
      haveFoundGroup = true;
    } else {
      groupList
        .filter((currentGroup) => currentGroup.subGroups)
        .forEach((currentGroup) => {
          if (this.buildGroupPath(groupId, currentGroup.subGroups, groupPath)) {
            groupPath.push(currentGroup);
            haveFoundGroup = true;
          }
        });
    }
    return haveFoundGroup;
  }
}
